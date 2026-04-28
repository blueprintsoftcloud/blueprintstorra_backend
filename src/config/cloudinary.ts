import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";
import { env } from "./env";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a file buffer to Cloudinary.
 * @param buffer - File buffer from multer memoryStorage
 * @param folder - Cloudinary folder path (e.g. "categories/cotton")
 * @returns Secure URL of the uploaded image
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder, resource_type: "image" }, (error, result) => {
        if (error || !result)
          return reject(error ?? new Error("Cloudinary upload failed"));
        resolve(result.secure_url);
      })
      .end(buffer);
  });
}

/**
 * Delete an image from Cloudinary by its public URL or public_id.
 */
export async function deleteFromCloudinary(
  urlOrPublicId: string,
): Promise<void> {
  // Extract public_id from a full Cloudinary URL
  const publicId = urlOrPublicId.includes("cloudinary.com")
    ? urlOrPublicId
        .split("/")
        .slice(-2)
        .join("/")
        .replace(/\.[^/.]+$/, "")
    : urlOrPublicId;

  await cloudinary.uploader.destroy(publicId);
}

export default cloudinary;
