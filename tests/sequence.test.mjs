import assert from "node:assert/strict";
import { test } from "node:test";
import {
	SEQUENCE_CATCH_UP_DAYS,
	buildJoinedInWindowFilter,
	getJoinWindow,
	getSendableSteps,
	getSequenceProblem,
	getSequenceStepContent,
	parseSequenceSteps,
} from "../lib/sequence-rules.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const STEP_A = "64f1a2b3c4d5e6f7a8b9c0a1";
const STEP_B = "64f1a2b3c4d5e6f7a8b9c0a2";
const isObjectId = (id) => /^[a-f0-9]{24}$/.test(id);

function newsletter(enabled = true) {
	return {
		sequence: {
			enabled,
			steps: [
				{ _id: STEP_B, delayDays: 3, subject: "Day 3", previewText: " Hi ", markdown: "Three" },
				{ _id: STEP_A, delayDays: 1, subject: " Day 1 ", markdown: "One" },
				{ _id: "64f1a2b3c4d5e6f7a8b9c0a3", delayDays: 5, subject: "No content", markdown: "  " },
			],
		},
	};
}

test("a step's email comes from the newsletter, only while the sequence is on", () => {
	assert.deepEqual(getSequenceStepContent(newsletter(), STEP_A), { format: "markdown", subject: "Day 1", markdown: "One", previewText: "" });
	assert.equal(getSequenceStepContent(newsletter(), STEP_B).previewText, "Hi");
	assert.equal(getSequenceStepContent(newsletter(false), STEP_A), null);
	assert.equal(getSequenceStepContent(newsletter(), "64f1a2b3c4d5e6f7a8b9c0ff"), null, "a deleted step sends nothing");
});

test("only complete steps send, earliest first", () => {
	assert.deepEqual(getSendableSteps(newsletter()).map(({ delayDays }) => delayDays), [1, 3]);
	assert.deepEqual(getSendableSteps(newsletter(false)), []);
});

test("a step reaches contacts whose delay passed within the catch-up window", () => {
	const now = Date.UTC(2026, 10, 20, 12);
	const { from, to } = getJoinWindow(3, now);
	assert.equal(to.getTime(), now - 3 * DAY_MS);
	assert.equal(from.getTime(), now - (3 + SEQUENCE_CATCH_UP_DAYS) * DAY_MS);
	const filter = buildJoinedInWindowFilter({ newsletterId: "n", from, to });
	assert.equal(filter.status, "active");
	assert.deepEqual(filter.$or.at(0), { confirmedAt: { $gte: from, $lt: to } });
	assert.deepEqual(filter.$or.at(1), { confirmedAt: { $exists: false }, subscribedAt: { $gte: from, $lt: to } });
});

test("form rows become steps, keeping known ids and skipping empty rows", () => {
	const steps = parseSequenceSteps(
		{ ids: [STEP_A, "", "junk"], delays: ["1", "", "4"], subjects: ["One", "", "Four"], previewTexts: ["", "", ""], markdowns: ["Body", "", "Body"] },
		isObjectId
	);
	assert.equal(steps.length, 2);
	assert.equal(steps.at(0)._id, STEP_A);
	assert.equal(steps.at(0).delayDays, 1);
	assert.equal("_id" in steps.at(1), false, "an unknown id is a new step");
});

test("steps need a whole-number delay, a subject and content", () => {
	assert.equal(getSequenceProblem({ enabled: true, steps: [] }), "Add at least one email to the sequence, or switch it off");
	assert.equal(getSequenceProblem({ enabled: false, steps: [] }), null);
	assert.match(getSequenceProblem({ enabled: true, steps: [{ delayDays: 0, subject: "a", markdown: "b" }] }), /whole number/);
	assert.match(getSequenceProblem({ enabled: true, steps: [{ delayDays: 2.5, subject: "a", markdown: "b" }] }), /whole number/);
	assert.match(getSequenceProblem({ enabled: true, steps: [{ delayDays: 2, subject: "", markdown: "b" }] }), /subject and content/);
	assert.equal(getSequenceProblem({ enabled: true, steps: [{ delayDays: 2, subject: "a", markdown: "b" }] }), null);
});
