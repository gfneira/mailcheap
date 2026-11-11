// Email sequence: emails that go out a set number of days after each contact joins (lib/sequence.js sends them).

export const SEQUENCE_LIMITS = { maxSteps: 30, minDelayDays: 1, maxDelayDays: 365 };
// A contact is due a step once its delay has passed, for this long. Later than that the step is skipped,
// so a step added today doesn't go out to everyone who joined months ago, and a missed run still catches up.
export const SEQUENCE_CATCH_UP_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

// The step's email, or null when the sequence is off or the step is incomplete.
export function getSequenceStepContent(newsletter, stepId) {
	if (!newsletter?.sequence?.enabled || !stepId) return null;
	const step = (newsletter.sequence.steps ?? []).find(({ _id }) => String(_id) === String(stepId));
	if (!step?.subject?.trim() || !step.markdown?.trim()) return null;
	return { format: "markdown", subject: step.subject.trim(), markdown: step.markdown, previewText: step.previewText?.trim() ?? "" };
}

// Steps that can go out, earliest first.
export function getSendableSteps(newsletter) {
	if (!newsletter?.sequence?.enabled) return [];
	return (newsletter.sequence.steps ?? [])
		.filter((step) => Number.isInteger(step.delayDays) && step.delayDays >= SEQUENCE_LIMITS.minDelayDays && getSequenceStepContent(newsletter, step._id))
		.sort((a, b) => a.delayDays - b.delayDays);
}

// Contacts who joined inside this window are due the step now.
export function getJoinWindow(delayDays, now = Date.now()) {
	return {
		from: new Date(now - (delayDays + SEQUENCE_CATCH_UP_DAYS) * DAY_MS),
		to: new Date(now - delayDays * DAY_MS),
	};
}

// A contact joins when it signs up, or when it confirms on newsletters that ask for confirmation.
export function buildJoinedInWindowFilter({ newsletterId, from, to }) {
	return {
		newsletterId,
		status: "active",
		$or: [
			{ confirmedAt: { $gte: from, $lt: to } },
			{ confirmedAt: { $exists: false }, subscribedAt: { $gte: from, $lt: to } },
		],
	};
}

// Form values to saved steps. An unknown id means a new step; a kept id keeps its "already sent" history.
export function parseSequenceSteps({ ids = [], delays = [], subjects = [], previewTexts = [], markdowns = [] }, isObjectId) {
	const steps = [];
	for (let index = 0; index < subjects.length; index++) {
		const id = String(ids[index] ?? "").trim();
		const step = {
			delayDays: Number(String(delays[index] ?? "").trim()),
			subject: String(subjects[index] ?? "").trim(),
			previewText: String(previewTexts[index] ?? "").trim(),
			markdown: String(markdowns[index] ?? ""),
		};
		if (!step.subject && !step.markdown.trim() && !String(delays[index] ?? "").trim()) continue;
		if (id && isObjectId(id)) step._id = id;
		steps.push(step);
	}
	return steps;
}

export function getSequenceProblem(sequence) {
	const { maxSteps, minDelayDays, maxDelayDays } = SEQUENCE_LIMITS;
	const steps = sequence?.steps ?? [];
	if (steps.length > maxSteps) return `A sequence can have up to ${maxSteps} emails`;
	for (const [index, step] of steps.entries()) {
		const label = `Sequence email ${index + 1}`;
		if (!Number.isInteger(step.delayDays) || step.delayDays < minDelayDays || step.delayDays > maxDelayDays) {
			return `${label}: days after signup should be a whole number from ${minDelayDays} to ${maxDelayDays}`;
		}
		if (!step.subject || !step.markdown.trim()) return `${label} needs a subject and content`;
	}
	if (sequence?.enabled && steps.length === 0) return "Add at least one email to the sequence, or switch it off";
	return null;
}
