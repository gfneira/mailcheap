import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { withQStashSignature } from "@/lib/qstash-route";
import { runSequenceTick } from "@/lib/sequence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Called every hour by the QStash schedule (lib/sequence.js). A thrown error (database down) is retried.
// The error's message goes back in the response so QStash's log shows why a run failed.
async function handleSequence() {
	try {
		const result = await runSequenceTick();
		console.info(`[sequence] ${JSON.stringify(result)}`);
		return NextResponse.json(result);
	} catch (error) {
		console.error("[sequence] Run failed:", error);
		return NextResponse.json({ error: String(error?.message ?? error).slice(0, 500), name: error?.name }, { status: 500 });
	}
}

const qstashPost = withQStashSignature(handleSequence);

// Hosts without QStash run an hourly cron job instead: curl -X POST -H "Authorization: Bearer $CRON_SECRET" <app>/api/jobs/send-sequence
function hasCronSecret(request) {
	const secret = process.env.CRON_SECRET;
	if (!secret || secret.length < 16) return false;
	const given = Buffer.from(request.headers.get("authorization") ?? "");
	const expected = Buffer.from(`Bearer ${secret}`);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request) {
	if (hasCronSecret(request)) return handleSequence();
	return qstashPost(request);
}
