const mongoose = require('mongoose');

const MODES = ['bus', 'train', 'flight'];
/**
 * Provider lifecycle (onboarding -> discontinuation):
 *   pending --approve--> active --suspend--> suspended --reactivate--> active
 *   any --discontinue--> discontinued (terminal; trips cancelled, customers refunded)
 */
const PROVIDER_STATUSES = ['pending', 'active', 'suspended', 'discontinued'];

const providerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    companyName: { type: String, required: true, trim: true, maxlength: 80 },
    servicesOffered: {
      type: [{ type: String, enum: MODES }],
      validate: [(v) => v.length > 0, 'At least one service is required'],
    },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, match: /^[0-9]{10}$/ },
    description: { type: String, trim: true, maxlength: 500 },
    rating: { type: Number, min: 0, max: 5, default: 4.2 },
    status: { type: String, enum: PROVIDER_STATUSES, default: 'pending' },
    statusReason: { type: String, trim: true, maxlength: 300 },
    approvedAt: Date,
    discontinuedAt: Date,
  },
  { timestamps: true },
);

providerSchema.index({ status: 1 });

const Provider = mongoose.model('Provider', providerSchema);

module.exports = { Provider, MODES, PROVIDER_STATUSES };
