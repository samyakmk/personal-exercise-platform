import { Storage } from '@google-cloud/storage';

export function createCloudMedia(bucketName) {
  const bucket = new Storage().bucket(bucketName);
  return {
    async write(key, bytes) {
      await bucket.file(key).save(bytes, {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    },
    read(key, start, length) {
      return bucket.file(key).createReadStream({ start, end: start + length - 1, validation: false });
    },
    async remove(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
  };
}
