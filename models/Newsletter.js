import mongoose from "mongoose";

const newsletterSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true },
		slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
		imageUrl: { type: String, trim: true },
		fromName: { type: String, trim: true },
		fromEmail: { type: String, required: true, lowercase: true, trim: true },
		replyTo: { type: String, lowercase: true, trim: true },
		postalAddress: { type: String, trim: true },
		archiveEnabled: { type: Boolean, default: false },
		description: { type: String, trim: true },
		socialLinks: [{ type: String, trim: true }],
		// The archive's author page; the author's name is fromName.
		author: {
			bio: { type: String, trim: true },
			imageUrl: { type: String, trim: true },
		},
		// New signups get an email with a link and only join once they click it (confirmed opt-in).
		requireConfirmation: { type: Boolean, default: false },
		// Checked when an issue is sent (lib/cleanup.js). Empty numbers use the newsletter's defaults.
		cleanup: {
			enabled: { type: Boolean, default: false },
			issues: { type: Number, min: 1 },
			days: { type: Number, min: 1 },
		},
		welcome: {
			enabled: { type: Boolean, default: false },
			subject: { type: String, trim: true },
			previewText: { type: String, trim: true },
			markdown: { type: String },
		},
		// Emails sent a set number of days after each contact joins (lib/sequence.js).
		sequence: {
			enabled: { type: Boolean, default: false },
			steps: [
				{
					delayDays: { type: Number, min: 1, max: 365, required: true },
					subject: { type: String, trim: true },
					previewText: { type: String, trim: true },
					markdown: { type: String },
				},
			],
		},
		// The newsletter's own confirmation email; the built-in one goes out until it has one.
		confirmation: {
			subject: { type: String, trim: true },
			previewText: { type: String, trim: true },
			markdown: { type: String },
		},
	},
	{ timestamps: true }
);

export default mongoose.models.Newsletter || mongoose.model("Newsletter", newsletterSchema);
