import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-keys";
import { connectDb } from "@/lib/db";
import { isRateLimited } from "@/lib/rate-limit";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

const READS_PER_KEY = { name: "api-stats-read", limit: 120, window: "1 h" };

function fail(status, error) {
	return NextResponse.json({ error }, { status });
}

// Subscriber counts for one newsletter, so automations can act on list size (e.g. start a weekly
// email once the list reaches a size). Counts only, never addresses.
export async function GET(request) {
	const apiKey = await authenticateRequest(request);
	if (!apiKey) return fail(401, "Invalid API key");
	if (await isRateLimited({ ...READS_PER_KEY, key: String(apiKey._id) })) return fail(429, "Too many requests");

	const slug = new URL(request.url).searchParams.get("newsletter")?.trim().toLowerCase();
	if (!slug) return fail(400, "newsletter is required");

	await connectDb();
	const newsletter = await Newsletter.findOne({ slug }).select({ _id: 1, slug: 1 }).lean();
	if (!newsletter) return fail(404, "Newsletter not found");

	const rows = await Contact.aggregate([
		{ $match: { newsletterId: newsletter._id } },
		{ $group: { _id: "$status", count: { $sum: 1 } } },
	]);
	const byStatus = Object.fromEntries(rows.map(({ _id, count }) => [_id, count]));
	return NextResponse.json({
		newsletter: newsletter.slug,
		subscribers: byStatus.active ?? 0,
		byStatus,
	});
}
