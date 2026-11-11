import "server-only";
import { sendAlert } from "@/lib/alerts";
import { LIMITS, getAppUrl, isSendingEnabled } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { mailboxProvider } from "@/lib/providers";
import { buildJoinedInWindowFilter, getJoinWindow, getSendableSteps, getSequenceStepContent } from "@/lib/sequence-rules";
import { getQStash, sendMessageBatch } from "@/lib/sending";
import { MAX_BATCH_MESSAGES, SEND_BATCH_SIZE, chunk, getSendProblem } from "@/lib/sending-rules";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Suppression from "@/models/Suppression";

// QStash calls the job on this schedule; one schedule serves every newsletter.
export const SEQUENCE_SCHEDULE_ID = "mailcheap-sequence";
const SEQUENCE_CRON = "0 * * * *";
const INSERT_CHUNK_SIZE = 1000;
const PUBLISH_CHUNK_SIZE = 100;
// A queued email this old was published and never sent (QStash gave up): the next run publishes it again.
const STALE_QUEUED_MS = 30 * 60 * 1000;

// Idempotent: QStash keeps one schedule per id, so saving settings again only updates it.
// Without QStash, a cron job on the server calls the route with CRON_SECRET instead (README).
export async function ensureSequenceSchedule() {
	if (!process.env.QSTASH_TOKEN) {
		if (process.env.CRON_SECRET) return;
		throw new Error("set QSTASH_TOKEN, or CRON_SECRET and an hourly cron job (see README)");
	}
	await getQStash().schedules.create({
		scheduleId: SEQUENCE_SCHEDULE_ID,
		destination: `${getAppUrl()}/api/jobs/send-sequence`,
		cron: SEQUENCE_CRON,
		retries: 3,
	});
}

async function insertIgnoringDuplicates(messages) {
	if (messages.length === 0) return 0;
	try {
		const inserted = await Message.insertMany(messages, { ordered: false });
		return inserted.length;
	} catch (error) {
		const codes = (error?.writeErrors ?? []).map(({ err, code }) => err?.code ?? code);
		const isOnlyDuplicates = codes.length > 0 ? codes.every((code) => code === 11000) : error?.code === 11000;
		if (!isOnlyDuplicates) throw error;
		return error?.insertedDocs?.length ?? 0;
	}
}

// One step: every active contact whose delay just passed gets a queued message, once.
async function queueStep({ newsletter, step, suppressed, now }) {
	const { from, to } = getJoinWindow(step.delayDays, now);
	const contacts = Contact.find(buildJoinedInWindowFilter({ newsletterId: newsletter._id, from, to }))
		.select({ email: 1 })
		.lean()
		.cursor();
	let queued = 0;
	let pending = [];
	const flush = async () => {
		queued += await insertIgnoringDuplicates(
			pending
				.filter(({ email }) => !suppressed.has(email))
				.map((contact) => ({
					kind: "sequence",
					sequenceStepId: step._id,
					newsletterId: newsletter._id,
					contactId: contact._id,
					email: contact.email,
					provider: mailboxProvider(contact.email),
				}))
		);
		pending = [];
	};
	for await (const contact of contacts) {
		pending.push(contact);
		if (pending.length === INSERT_CHUNK_SIZE) await flush();
	}
	await flush();
	return queued;
}

// Hands the newsletter's queued sequence emails to the batch job, at the campaign sending rate.
async function publishQueued(newsletter, now) {
	const queued = await Message.find({
		newsletterId: newsletter._id,
		kind: "sequence",
		status: "queued",
		$or: [{ createdAt: { $gte: new Date(now - 5 * 60 * 1000) } }, { createdAt: { $lt: new Date(now - STALE_QUEUED_MS) } }],
	})
		.sort({ _id: 1 })
		.select({ _id: 1 })
		.lean();
	const ids = queued.map(({ _id }) => String(_id));
	// Without QStash (a server cron job calls the route instead), this run sends them itself, at the same rate.
	if (!process.env.QSTASH_TOKEN) {
		for (const messageIds of chunk(ids, MAX_BATCH_MESSAGES)) {
			const result = await sendMessageBatch(messageIds);
			if (result.retry) break;
		}
		return ids.length;
	}
	const url = `${getAppUrl()}/api/jobs/send-batch`;
	const flowControl = {
		key: `sequence-${newsletter._id}`,
		parallelism: 1,
		rate: 1,
		period: `${Math.ceil(SEND_BATCH_SIZE / LIMITS.sendRatePerSecond)}s`,
	};
	const requests = chunk(ids, SEND_BATCH_SIZE).map((messageIds) => ({ url, body: { messageIds }, flowControl }));
	for (const group of chunk(requests, PUBLISH_CHUNK_SIZE)) await getQStash().batchJSON(group);
	return queued.length;
}

// Runs every hour from the QStash schedule. Safe to run twice: each step reaches each contact once.
export async function runSequenceTick({ now = Date.now() } = {}) {
	if (!isSendingEnabled()) return { skipped: "sending is off" };
	await connectDb();
	const newsletters = await Newsletter.find({ "sequence.enabled": true }).lean();
	if (newsletters.length === 0) return { newsletters: 0 };

	const suppressed = new Set(await Suppression.distinct("email"));
	const results = [];
	for (const newsletter of newsletters) {
		const steps = getSendableSteps(newsletter);
		const problem = steps.length ? getSendProblem({ campaign: getSequenceStepContent(newsletter, steps.at(0)._id), newsletter }) : null;
		if (problem) {
			await sendAlert({
				key: `sequence-${newsletter.slug}`,
				title: "Email sequence not sending",
				detail: `${newsletter.name}: ${problem}`,
				path: `/newsletters/${newsletter._id}`,
			});
			results.push({ slug: newsletter.slug, skipped: problem });
			continue;
		}
		let queued = 0;
		for (const step of steps) queued += await queueStep({ newsletter, step, suppressed, now });
		const published = await publishQueued(newsletter, now);
		results.push({ slug: newsletter.slug, steps: steps.length, queued, published });
	}
	return { newsletters: newsletters.length, results };
}
