const mongoose = require('mongoose');
const { Schema } = mongoose;

const User = mongoose.model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
}));

const File = mongoose.model('File', new Schema({
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  size: { type: Number, required: true },
  mime: String,
  key: { type: String, required: true },               // where the bytes live (disk filename or S3 key)
  sharedWith: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  shareToken: { type: String, index: true },           // public link token
  shareExpires: Date,
  createdAt: { type: Date, default: Date.now },
}));

module.exports = { User, File };
