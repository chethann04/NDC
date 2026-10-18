import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  X,
  RotateCcw,
  Check,
  SwitchCamera,
  AlertCircle,
  Upload,
  FlipHorizontal
} from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  title?: string;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCapture,
  title = 'Capture Logbook Page'
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashAnimation, setFlashAnimation] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isMirrored, setIsMirrored] = useState(false);
  const [isCapturedMirrored, setIsCapturedMirrored] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  // Safely stop all active media stream tracks without triggering state cascade
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('[CameraCaptureModal] Error stopping track:', e);
        }
      });
      streamRef.current = null;
    }
    setStream(null);
  }, []);

  // Request camera access with resilient fallbacks for laptop webcams & mobile cameras
  const initCamera = useCallback(
    async (targetFacingMode: 'environment' | 'user') => {
      setIsInitializing(true);
      setCameraError(null);
      stopStream();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera access is not supported in this browser. Please upload a photo or use a modern browser.');
        setIsInitializing(false);
        return;
      }

      // Check available cameras to know if Flip camera button should appear
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoDevices.length > 1);
      } catch (e) {
        // Enumerate devices may fail if permissions aren't granted yet, ignore gracefully
      }

      let activeStream: MediaStream | null = null;

      // Tiered fallback constraints to guarantee opening on any laptop webcam or mobile camera
      const constraintCandidates: MediaStreamConstraints[] = [
        // 1. Target facing mode with ideal HD resolution
        {
          video: {
            facingMode: { ideal: targetFacingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        },
        // 2. Target facing mode without resolution constraints
        {
          video: {
            facingMode: { ideal: targetFacingMode }
          },
          audio: false
        },
        // 3. Fallback to user camera (laptop webcam)
        {
          video: {
            facingMode: 'user'
          },
          audio: false
        },
        // 4. Absolute fallback to any available video input
        {
          video: true,
          audio: false
        }
      ];

      for (const constraints of constraintCandidates) {
        try {
          activeStream = await navigator.mediaDevices.getUserMedia(constraints);
          if (activeStream) break;
        } catch (err: any) {
          // If permission was explicitly denied, abort immediately
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setCameraError('Camera access permission was denied. Please allow camera permissions in your browser or choose a file.');
            setIsInitializing(false);
            return;
          }
          // Continue to next constraint tier
        }
      }

      if (!activeStream) {
        setCameraError('Could not start any video feed from your camera. Ensure your camera is not in use by another application.');
        setIsInitializing(false);
        return;
      }

      streamRef.current = activeStream;
      setStream(activeStream);

      // Inspect actual track settings to adjust mirror default for laptop webcams
      const track = activeStream.getVideoTracks()[0];
      const settings = track?.getSettings ? track.getSettings() : null;
      const actualFacing = settings?.facingMode || targetFacingMode;
      // Laptop webcams are usually 'user'
      if (actualFacing === 'user') {
        // Default to not mirrored for document reading so text isn't flipped
        setIsMirrored(false);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = activeStream;
        videoRef.current.play().catch((e) => {
          console.warn('[CameraCaptureModal] Auto-play was interrupted:', e);
        });
      }

      setIsInitializing(false);
    },
    [stopStream]
  );

  // Trigger camera startup when modal opens
  useEffect(() => {
    if (isOpen) {
      setCapturedBlob(null);
      setCapturedUrl(null);
      setIsCapturedMirrored(false);
      initCamera(facingMode);
    } else {
      stopStream();
    }

    return () => {
      stopStream();
      if (capturedUrl) {
        URL.revokeObjectURL(capturedUrl);
      }
    };
  }, [isOpen, facingMode, initCamera, stopStream]);

  // Keep video srcObject attached if videoRef remounts
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Toggle front & back camera
  const handleToggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
  };

  // Flip horizontal (un-mirror/mirror) for live feed
  const handleToggleLiveMirror = () => {
    setIsMirrored((prev) => !prev);
  };

  // Capture frame to canvas
  const handleCapturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Trigger visual flash animation
    setFlashAnimation(true);
    setTimeout(() => setFlashAnimation(false), 200);

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    if (isMirrored) {
      // If the user was viewing mirrored, preserve that in the capture
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();

    canvas.toBlob(
      (blob) => {
        if (blob) {
          setCapturedBlob(blob);
          const url = URL.createObjectURL(blob);
          setCapturedUrl(url);
          setIsCapturedMirrored(false);
          stopStream();
        }
      },
      'image/jpeg',
      0.92
    );
  };

  // Flip the captured photo horizontally (essential for laptop webcams if text was mirrored!)
  const handleFlipCapturedPhoto = () => {
    if (!capturedUrl || !canvasRef.current) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = capturedUrl;
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Flip horizontally
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();

      canvas.toBlob(
        (newBlob) => {
          if (newBlob) {
            URL.revokeObjectURL(capturedUrl);
            const newUrl = URL.createObjectURL(newBlob);
            setCapturedBlob(newBlob);
            setCapturedUrl(newUrl);
            setIsCapturedMirrored((prev) => !prev);
          }
        },
        'image/jpeg',
        0.92
      );
    };
  };

  // Retake photo
  const handleRetake = () => {
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
    }
    setCapturedBlob(null);
    setCapturedUrl(null);
    setIsCapturedMirrored(false);
    initCamera(facingMode);
  };

  // Accept and use captured photo
  const handleAcceptPhoto = () => {
    if (!capturedBlob) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const photoFile = new File([capturedBlob], `logbook_scan_${timestamp}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });

    onCapture(photoFile);
    handleClose();
  };

  const handleClose = () => {
    stopStream();
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
    }
    setCapturedBlob(null);
    setCapturedUrl(null);
    onClose();
  };

  const handleFallbackFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      onCapture(selected);
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-3 sm:p-5 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      {/* Hidden canvas for high-res snapshot & flipping */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Hidden file input for native device camera fallback */}
      <input
        ref={fallbackInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFallbackFileSelect}
        className="hidden"
      />

      <div
        className="relative w-full max-w-3xl bg-slate-900 rounded-3xl shadow-2xl border border-slate-700 overflow-hidden flex flex-col max-h-[92vh] text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Visual Flash effect */}
        {flashAnimation && (
          <div className="absolute inset-0 bg-white z-50 pointer-events-none transition-opacity duration-150 opacity-90" />
        )}

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur-sm z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <span>{title}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-900/80 text-indigo-300 border border-indigo-700/50">
                  {facingMode === 'user' ? 'Laptop / Webcam' : 'Live Viewfinder'}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">Position the logbook register flat and capture high-clarity text</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!capturedUrl && (
              <button
                type="button"
                onClick={handleToggleLiveMirror}
                className={`p-2 rounded-xl border text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                  isMirrored
                    ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/50'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
                }`}
                title={isMirrored ? 'Mirrored view is ON (click to un-mirror)' : 'Normal view (click to mirror)'}
              >
                <FlipHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline text-[11px]">{isMirrored ? 'Mirrored' : 'Unmirrored'}</span>
              </button>
            )}

            {hasMultipleCameras && !capturedUrl && (
              <button
                type="button"
                onClick={handleToggleFacingMode}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Switch front / rear camera"
              >
                <SwitchCamera className="w-4 h-4" />
                <span className="hidden sm:inline text-[11px]">Flip Cam</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video / Captured Image Container */}
        <div className="relative flex-1 bg-black flex items-center justify-center min-h-[380px] sm:min-h-[460px] overflow-hidden">
          {capturedUrl ? (
            /* PREVIEW OF CAPTURED PHOTO */
            <div className="relative w-full h-full flex flex-col items-center justify-center bg-slate-950 p-3">
              <img
                src={capturedUrl}
                alt="Captured logbook"
                className="max-h-[64vh] w-auto max-w-full object-contain rounded-xl shadow-lg border border-slate-800"
              />
              <div className="absolute top-4 left-4 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-md flex items-center gap-1.5 shadow-md">
                <Check className="w-3.5 h-3.5" />
                <span>Photo Captured</span>
              </div>

              {/* Helpful Laptop Webcam Notice */}
              <div className="mt-2 text-center">
                <p className="text-[11px] text-slate-400">
                  Is the text reversed or backwards? Click <span className="text-indigo-300 font-semibold">Flip / Un-mirror</span> below to correct it for AI reading.
                </p>
              </div>
            </div>
          ) : cameraError ? (
            /* ERROR OR NO PERMISSION STATE */
            <div className="p-8 text-center max-w-md mx-auto space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mx-auto flex items-center justify-center">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h4 className="font-bold text-base text-slate-100">Camera Access Notice</h4>
              <p className="text-xs text-slate-400 leading-relaxed">{cameraError}</p>
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => initCamera(facingMode)}
                  className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry Camera</span>
                </button>
                <button
                  type="button"
                  onClick={() => fallbackInputRef.current?.click()}
                  className="w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs flex items-center justify-center gap-2 border border-slate-700 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Choose Photo / Use Native Camera</span>
                </button>
              </div>
            </div>
          ) : (
            /* LIVE VIDEO FEED */
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={() => {
                  setIsInitializing(false);
                  videoRef.current?.play().catch(() => {});
                }}
                className={`w-full h-full max-h-[70vh] object-contain transition-transform duration-150 ${
                  isMirrored ? '-scale-x-100' : 'scale-x-100'
                }`}
              />

              {/* Document Framing Guidelines Overlay */}
              <div className="absolute inset-4 sm:inset-10 pointer-events-none border border-indigo-400/30 rounded-2xl flex flex-col justify-between p-4">
                {/* 4 Corner Markers */}
                <div className="flex justify-between items-start">
                  <div className="w-8 h-8 border-t-4 border-l-4 border-indigo-400 rounded-tl-lg" />
                  <div className="w-8 h-8 border-t-4 border-r-4 border-indigo-400 rounded-tr-lg" />
                </div>

                <div className="text-center px-4 py-2 rounded-xl bg-slate-950/70 backdrop-blur-md mx-auto border border-white/10 max-w-md">
                  <p className="text-xs font-medium text-slate-200">
                    Align the logbook columns (USN, Name, Amount) flat inside the frame
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Ensure good lighting and avoid shadows</p>
                </div>

                <div className="flex justify-between items-end">
                  <div className="w-8 h-8 border-b-4 border-l-4 border-indigo-400 rounded-bl-lg" />
                  <div className="w-8 h-8 border-b-4 border-r-4 border-indigo-400 rounded-br-lg" />
                </div>
              </div>

              {isInitializing && (
                <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-3 text-xs text-indigo-300 z-20">
                  <div className="w-7 h-7 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span className="font-medium">Connecting to camera viewfinder...</span>
                  <span className="text-[10px] text-slate-400">If prompted, click Allow camera access</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Controls Footer */}
        <div className="px-5 py-4 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>AI Document Scanner Ready</span>
          </div>

          <div className="flex items-center gap-3">
            {capturedUrl ? (
              <>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-slate-400" />
                  <span>Retake</span>
                </button>

                {/* Flip Horizontal button for captured image */}
                <button
                  type="button"
                  onClick={handleFlipCapturedPhoto}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Flip photo horizontally so mirrored text reads normally"
                >
                  <FlipHorizontal className="w-4 h-4" />
                  <span>Flip / Un-mirror</span>
                </button>

                <button
                  type="button"
                  onClick={handleAcceptPhoto}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Use Photo & Run OCR</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => fallbackInputRef.current?.click()}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Upload from device photo library"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Browse Photo</span>
                </button>

                <button
                  type="button"
                  onClick={handleCapturePhoto}
                  disabled={isInitializing || Boolean(cameraError)}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="w-4 h-4 rounded-full border-2 border-white flex items-center justify-center">
                    <div className="w-2 h-2 bg-white rounded-full" />
                  </div>
                  <span>Capture Photo</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
