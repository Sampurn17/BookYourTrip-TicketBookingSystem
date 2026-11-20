const AppError = require('../utils/AppError');
const { User, Provider } = require('../models');
const { signToken } = require('../middleware/auth');

function serializeUser(user, provider) {
  const out = {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    createdAt: user.createdAt,
  };
  if (provider) {
    out.provider = {
      _id: provider._id,
      companyName: provider.companyName,
      servicesOffered: provider.servicesOffered,
      status: provider.status,
      statusReason: provider.statusReason,
      contactEmail: provider.contactEmail,
      contactPhone: provider.contactPhone,
      description: provider.description,
      rating: provider.rating,
    };
  }
  return out;
}

async function profileFor(user) {
  const provider = user.role === 'provider' ? await Provider.findOne({ userId: user._id }) : null;
  return serializeUser(user, provider);
}

async function signup(data) {
  if (await User.exists({ email: data.email })) {
    throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }
  const user = await User.create({
    name: data.name,
    email: data.email,
    password: data.password,
    phone: data.phone,
    role: data.role,
  });

  let provider = null;
  if (data.role === 'provider') {
    try {
      provider = await Provider.create({
        userId: user._id,
        companyName: data.companyName,
        servicesOffered: data.servicesOffered,
        contactEmail: data.email,
        contactPhone: data.phone,
        status: 'pending', // onboarding: an admin must approve before trips can be listed
      });
    } catch (err) {
      await User.deleteOne({ _id: user._id });
      throw err;
    }
  }
  return { token: signToken(user._id), user: serializeUser(user, provider) };
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.checkPassword(password))) {
    throw AppError.unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
  }
  return { token: signToken(user._id), user: await profileFor(user) };
}

async function updateProfile(user, updates) {
  if (updates.name !== undefined) user.name = updates.name;
  if (updates.phone !== undefined) user.phone = updates.phone;
  await user.save();
  return profileFor(user);
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+password');
  if (!(await user.checkPassword(currentPassword))) {
    throw AppError.unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  }
  user.password = newPassword;
  await user.save();
  return { token: signToken(user._id), user: await profileFor(user) };
}

module.exports = { signup, login, profileFor, updateProfile, changePassword, serializeUser };
