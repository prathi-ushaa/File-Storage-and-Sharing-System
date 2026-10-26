// One interface, two backends: local disk (default) or Amazon S3 (when S3_BUCKET is set).
const fs = require('fs');
const path = require('path');

const DIR = process.env.UPLOAD_DIR || '/data/uploads';
const BUCKET = process.env.S3_BUCKET;
let s3, sdk;

if (BUCKET) {
  sdk = require('@aws-sdk/client-s3');
  s3 = new sdk.S3Client({ region: process.env.AWS_REGION }); // credentials come from the EC2 IAM role
} else {
  fs.mkdirSync(DIR, { recursive: true });
}

exports.mode = BUCKET ? 's3' : 'local';

exports.put = async (key, buffer, mime) => {
  if (BUCKET) {
    await s3.send(new sdk.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: mime }));
  } else {
    await fs.promises.writeFile(path.join(DIR, key), buffer);
  }
};

exports.get = async (key) => {
  if (BUCKET) {
    const r = await s3.send(new sdk.GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return r.Body; // readable stream
  }
  return fs.createReadStream(path.join(DIR, key));
};

exports.remove = async (key) => {
  if (BUCKET) {
    await s3.send(new sdk.DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } else {
    await fs.promises.unlink(path.join(DIR, key)).catch(() => {});
  }
};
