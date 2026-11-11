import mongoose from "mongoose";

export const MESSAGE_STATUSES = [
	"queued",
	"sent",
	"delivered",
	"bounced",
	"complained",
	"failed",
	"suppressed",
];

const messageSchema = new mongoose.Schema(
	{
		kind: { type: String, enum: ["campaign", "last-chance", "welcome", "confirmation", "sequence", "test"], required: true },
		campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },
		// Which email of the newsletter's sequence (newsletter.sequence.steps[]._id).
		sequenceStepId: { type: mongoose.Schema.Types.ObjectId },
		email: { type: String, required: true, lowercase: true, trim: true },
		provider: { type: String },
		status: { type: String, enum: MESSAGE_STATUSES, default: "queued" },
		sesMessageId: { type: String },
		error: { type: String },
		sentAt: Date,
		deliveredAt: Date,
		openedAt: Date,
		clickedAt: Date,
		bouncedAt: Date,
		complainedAt: Date,
	},
	{ timestamps: true }
);

// One email per contact per campaign, even if a send job is retried.
messageSchema.index(
	{ campaignId: 1, contactId: 1 },
	{ unique: true, partialFilterExpression: { kind: "campaign" } }
);
// And at most one last-chance email per contact per send.
messageSchema.index(
	{ campaignId: 1, contactId: 1, kind: 1 },
	{ unique: true, partialFilterExpression: { kind: "last-chance" } }
);
// And each sequence email at most once per contact.
messageSchema.index(
	{ sequenceStepId: 1, contactId: 1 },
	{ unique: true, partialFilterExpression: { kind: "sequence" } }
);
messageSchema.index({ sesMessageId: 1 }, { sparse: true });
messageSchema.index({ kind: 1, createdAt: -1 });
// The overview's emails sent per hour.
messageSchema.index({ newsletterId: 1, sentAt: 1 });
messageSchema.index({ campaignId: 1, status: 1 });

export default mongoose.models.Message || mongoose.model("Message", messageSchema);
