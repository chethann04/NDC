import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export interface PreprocessedImageResult {
  preprocessedBuffer: Buffer;
  originalBuffer: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  orientation?: number;
  isRotated: boolean;
  isLowLight?: boolean;
  lightingAdjusted?: boolean;
  pageCount: number;
  savedFilePath?: string;
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  pageCount: number;
  fileSize: number;
  mimeType: string;
}

export class ImagePreprocessingService {
  private static uploadsDir = path.join(process.cwd(), 'uploads', 'logbooks');
  private static readonly MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
  private static readonly MAX_PDF_PAGES = 10;
  private static readonly ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/tiff',
    'application/pdf'
  ];

  /**
   * Validate file size, mime type, and PDF page count before processing
   */
  public static validateInputFile(
    buffer: Buffer,
    mimeType: string,
    filename: string
  ): FileValidationResult {
    const fileSize = buffer ? buffer.length : 0;

    if (!buffer || fileSize === 0) {
      return {
        valid: false,
        error: 'INVALID_FILE: Uploaded file is empty (0 bytes).',
        pageCount: 0,
        fileSize: 0,
        mimeType
      };
    }

    if (fileSize > this.MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `FILE_TOO_LARGE: File size (${(fileSize / (1024 * 1024)).toFixed(1)} MB) exceeds institutional maximum limit of 15 MB.`,
        pageCount: 0,
        fileSize,
        mimeType
      };
    }

    const ext = path.extname(filename).toLowerCase();
    const isPdfExt = ext === '.pdf';
    const isPdfMime = mimeType === 'application/pdf';
    const isImage = mimeType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'].includes(ext);

    if (!isPdfMime && !isPdfExt && !isImage) {
      return {
        valid: false,
        error: `UNSUPPORTED_TYPE: File type "${mimeType || ext}" is not supported. Please upload a high-resolution photo (JPG, PNG, WEBP) or PDF logbook scan.`,
        pageCount: 0,
        fileSize,
        mimeType
      };
    }

    // PDF Page Count Validation
    let pageCount = 1;
    if (isPdfMime || isPdfExt) {
      pageCount = this.countPdfPages(buffer);
      if (pageCount > this.MAX_PDF_PAGES) {
        return {
          valid: false,
          error: `EXCEEDS_PAGE_LIMIT: Uploaded PDF contains ${pageCount} pages. Maximum allowed pages per scan job is ${this.MAX_PDF_PAGES}.`,
          pageCount,
          fileSize,
          mimeType: 'application/pdf'
        };
      }
    }

    return {
      valid: true,
      pageCount,
      fileSize,
      mimeType: (isPdfMime || isPdfExt) ? 'application/pdf' : mimeType
    };
  }

  /**
   * Fast, reliable PDF page counter inspecting standard /Type /Page objects in binary
   */
  public static countPdfPages(buffer: Buffer): number {
    try {
      const content = buffer.toString('binary');
      // Match /Type /Page (excluding /Pages parent tree)
      const matches = content.match(/\/Type\s*\/Page\b/g);
      if (matches && matches.length > 0) {
        return matches.length;
      }
      // Secondary check: /Count <N> in root catalog
      const countMatch = content.match(/\/Count\s+(\d+)/);
      if (countMatch && countMatch[1]) {
        return parseInt(countMatch[1], 10) || 1;
      }
    } catch {
      // Fallback to 1 if binary parse fails
    }
    return 1;
  }

  /**
   * Preprocess an uploaded logbook image:
   * 1. Detect orientation via EXIF or dimensions and rotate upright
   * 2. Analyze lighting and apply adaptive shadow lift for poorly lit photos
   * 3. Enhance contrast & stroke sharpness for handwritten text without erasing light ink
   * 4. Downscale oversized phone photos (> 2560px) to prevent OOM while keeping OCR clarity
   * 5. Preserve the exact original file on disk for side-by-side human verification
   */
  public static async preprocess(
    buffer: Buffer,
    originalMime: string,
    jobId: string,
    filename: string
  ): Promise<PreprocessedImageResult> {
    // Ensure uploads directory exists
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }

    // Save original image to disk for audit & human review
    const safeExt = path.extname(filename).toLowerCase() || (originalMime.includes('pdf') ? '.pdf' : '.png');
    const safeFilename = `${jobId}_original${safeExt}`;
    const savedFilePath = path.join(this.uploadsDir, safeFilename);

    try {
      fs.writeFileSync(savedFilePath, buffer);
    } catch (saveErr) {
      console.warn('[ImagePreprocessingService] Failed to save original file to disk:', saveErr);
    }

    // PDF files are passed through with page count
    if (originalMime === 'application/pdf' || safeExt === '.pdf') {
      const pageCount = this.countPdfPages(buffer);
      return {
        preprocessedBuffer: buffer,
        originalBuffer: buffer,
        mimeType: 'application/pdf',
        isRotated: false,
        pageCount,
        savedFilePath
      };
    }

    try {
      const metadata = await sharp(buffer).metadata();
      const hasExifOrientation = metadata.orientation && metadata.orientation > 1;

      // Pipeline starting with orientation normalization
      let pipeline = sharp(buffer)
        .rotate(); // Auto-rotate respects EXIF orientation tags

      // Check dimensions: resize long edge to max 2560px for giant phone captures
      if ((metadata.width && metadata.width > 2560) || (metadata.height && metadata.height > 2560)) {
        pipeline = pipeline.resize({
          width: 2560,
          height: 2560,
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Lighting & contrast analysis: detect poorly lit photos
      let isLowLight = false;
      let lightingAdjusted = false;
      try {
        const stats = await sharp(buffer).stats();
        const primaryChannel = stats.channels[0];
        if (primaryChannel && primaryChannel.mean < 85) {
          isLowLight = true;
          lightingAdjusted = true;
          // Apply brightness boost and gamma lift for dark lab photos
          pipeline = pipeline
            .modulate({ brightness: 1.25 })
            .gamma(1.15);
        }
      } catch {
        // Continue if stats collection fails on special formats
      }

      // Contrast enhancement: normalize dynamic range and apply gentle unsharp masking
      pipeline = pipeline
        .normalize()
        .sharpen({ sigma: 1.0, m1: 0.5, m2: 2.0 });

      // Save preprocessed version
      const preprocessedBuffer = await pipeline.png().toBuffer();
      const processedFilename = `${jobId}_processed.png`;
      const processedFilePath = path.join(this.uploadsDir, processedFilename);
      fs.writeFileSync(processedFilePath, preprocessedBuffer);

      return {
        preprocessedBuffer,
        originalBuffer: buffer,
        mimeType: 'image/png',
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        isRotated: Boolean(hasExifOrientation),
        isLowLight,
        lightingAdjusted,
        pageCount: 1,
        savedFilePath
      };
    } catch (err: any) {
      console.warn('[ImagePreprocessingService] Sharp processing failed, preserving raw buffer:', err.message);
      return {
        preprocessedBuffer: buffer,
        originalBuffer: buffer,
        mimeType: originalMime,
        isRotated: false,
        pageCount: 1,
        savedFilePath
      };
    }
  }

  /**
   * Get file path for a stored scan job image
   */
  public static getJobImagePath(jobId: string, processed = false): string | null {
    if (!fs.existsSync(this.uploadsDir)) return null;

    const prefix = `${jobId}_${processed ? 'processed' : 'original'}`;
    const files = fs.readdirSync(this.uploadsDir);
    const match = files.find((f) => f.startsWith(prefix));

    return match ? path.join(this.uploadsDir, match) : null;
  }
}
