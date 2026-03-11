import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const bucket = process.env.OBJECT_STORAGE_BUCKET || '';
const region = process.env.OBJECT_STORAGE_REGION || 'us-east-1';
const endpoint = process.env.OBJECT_STORAGE_ENDPOINT || '';
const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY || '';
const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_KEY || '';

const enabled = Boolean(bucket && accessKeyId && secretAccessKey && endpoint);

let s3 = null;
if (enabled) {
  s3 = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: process.env.OBJECT_STORAGE_PATH_STYLE === 'true',
  });
}

export function isObjectStorageEnabled() {
  return enabled;
}

export function getBucketName() {
  return bucket;
}

export async function uploadFileFromPath(localPath, key, contentType) {
  if (!enabled || !s3) return null;
  const body = fs.createReadStream(localPath);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || undefined,
  });
  await s3.send(command);
  return { bucket, key };
}

export async function getObjectStream(key) {
  if (!enabled || !s3) return null;
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  const out = await s3.send(command);
  return out; // includes Body stream and metadata
}

