import React, { useRef, useState, useEffect, useCallback } from "react";
import Webcam from "react-webcam";
import AWS from "aws-sdk";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { Box, CircularProgress, Alert, Typography, Paper, Fade, useTheme, useMediaQuery } from "@mui/material";
import { styled } from '@mui/material/styles';

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  region: "us-east-2",
});

const s3 = new AWS.S3({
  httpOptions: {
    timeout: 5000,
  },
  maxRetries: 3,
});

// Styled components
const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  borderRadius: 16,
  background: 'linear-gradient(145deg, #ffffff, #f0f0f0)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
  width: '100%',
  maxWidth: 720,
  margin: 'auto',
  overflow: 'hidden',
  transition: 'all 0.3s ease-in-out',
  [theme.breakpoints.down('sm')]: {
    padding: theme.spacing(2),
    borderRadius: 12,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
}));

const WebcamContainer = styled(Box)(({ theme }) => ({
  position: 'relative',
  width: '100%',
  height: 0,
  paddingBottom: '75%', // 4:3 aspect ratio
  margin: 'auto',
  borderRadius: 12,
  overflow: 'hidden',
  border: '2px solid #e0e0e0',
  background: '#000',
  transition: 'border-color 0.3s ease',
  '&:hover': {
    borderColor: theme.palette.primary.main,
  },
  [theme.breakpoints.down('sm')]: {
    paddingBottom: '100%', // Square aspect ratio for mobile
    borderRadius: 8,
  },
}));

const StatusOverlay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  background: 'rgba(0,0,0,0.7)',
  color: '#fff',
  padding: theme.spacing(1),
  textAlign: 'center',
  borderBottomLeftRadius: 12,
  borderBottomRightRadius: 12,
  [theme.breakpoints.down('sm')]: {
    padding: theme.spacing(0.5),
    fontSize: '0.8rem',
  },
}));

const CameraCapture = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isIPhone = /iPhone/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);

  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);
  const processingRef = useRef(false);
  const detectionStateRef = useRef({
    blinkCount: 0,
    lastBlinkTime: 0,
    faceDetected: false,
    consecutiveFrames: 0,
    earHistory: [],
    lastNosePosition: null,
    movementDetected: false,
  });

  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);

  const videoConstraints = {
    width: { ideal: isMobile ? 480 : 640 },
    height: { ideal: isMobile ? 480 : 480 },
    facingMode: "user",
  };

  // Check WebGL support
  const checkWebGLSupport = useCallback(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const supported = !!gl;
    console.log("WebGL supported:", supported);
    return supported;
  }, []);

  // Load MediaPipe scripts dynamically
  useEffect(() => {
    const loadMediaPipeScripts = async () => {
      try {
        if (!checkWebGLSupport()) {
          throw new Error("WebGL is not supported in this browser.");
        }
        console.log("Loading MediaPipe scripts for", isIPhone ? "iPhone" : isAndroid ? "Android" : "desktop");
        const scripts = [
          'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js',
          'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js',
        ];

        for (const src of scripts) {
          console.log(`Loading script: ${src}`);
          const script = document.createElement('script');
          script.src = src;
          script.async = false;
          document.head.appendChild(script);
          await new Promise((resolve, reject) => {
            script.onload = () => {
              console.log(`Script loaded successfully: ${src}`);
              resolve();
            };
            script.onerror = () => {
              console.error(`Failed to load script: ${src}`);
              reject(new Error(`Failed to load script: ${src}`));
            };
          });
        }

        if (!window.FaceMesh) {
          console.error("FaceMesh global not found");
          throw new Error("FaceMesh is not available");
        }
        if (!window.Camera) {
          console.error("Camera global not found");
          throw new Error("Camera is not available");
        }

        console.log("Initializing FaceMesh");
        const faceMesh = new window.FaceMesh({
          locateFile: (file) => {
            console.log(`Locating file: ${file}`);
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`;
          },
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults(handleFaceMeshResults);
        faceMeshRef.current = faceMesh;
        setModelsLoading(false);
        console.log("FaceMesh initialized successfully");
      } catch (err) {
        console.error("Failed to initialize face mesh:", err);
        setError("Failed to initialize face detection. Please refresh the page or try a different browser.");
        setModelsLoading(false);
      }
    };

    loadMediaPipeScripts();

    return () => {
      console.log("Cleaning up MediaPipe resources");
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      if (faceMeshRef.current) {
        faceMeshRef.current.close();
      }
    };
  }, [isIPhone, isAndroid, checkWebGLSupport]);

  const handleWebcamReady = useCallback(() => {
    if (webcamRef.current && webcamRef.current.video && !cameraRef.current) {
      const video = webcamRef.current.video;
      console.log("Webcam ready, user agent:", navigator.userAgent, "Video dimensions:", video.videoWidth, video.videoHeight);

      try {
        if (!window.Camera) {
          throw new Error("Camera is not available. Ensure MediaPipe camera_utils is loaded.");
        }
        console.log("Initializing MediaPipe Camera");
        cameraRef.current = new window.Camera(video, {
          onFrame: async () => {
            if (faceMeshRef.current && video.videoWidth > 0 && video.videoHeight > 0) {
              await faceMeshRef.current.send({ image: video });
            } else {
              console.warn("Invalid video dimensions, skipping frame");
            }
          },
          width: videoConstraints.width.ideal,
          height: videoConstraints.height.ideal,
        });
        cameraRef.current.start();
        console.log("MediaPipe Camera started successfully");
      } catch (err) {
        console.error("Failed to initialize camera:", err);
        setError("Failed to initialize camera processing. Please ensure webcam access and try again.");
        return;
      }

      setWebcamReady(true);
      console.log("Webcam initialized successfully");
    }
  }, [videoConstraints]);

  // Calculate Eye Aspect Ratio (EAR) for blink detection
  const calculateEAR = (eyeLandmarks) => {
    const A = Math.hypot(
      eyeLandmarks[1].x - eyeLandmarks[5].x,
      eyeLandmarks[1].y - eyeLandmarks[5].y
    );
    const B = Math.hypot(
      eyeLandmarks[2].x - eyeLandmarks[4].x,
      eyeLandmarks[2].y - eyeLandmarks[4].y
    );
    const C = Math.hypot(
      eyeLandmarks[0].x - eyeLandmarks[3].x,
      eyeLandmarks[0].y - eyeLandmarks[3].y
    );
    const ear = (A + B) / (2 * C);
    console.log("Calculated EAR:", ear);
    return ear;
  };

  // Calculate head movement based on nose tip position
  const calculateHeadMovement = (landmarks) => {
    const noseTip = landmarks[1];
    if (!detectionStateRef.current.lastNosePosition) {
      detectionStateRef.current.lastNosePosition = { x: noseTip.x, y: noseTip.y };
      return false;
    }

    const movement = Math.hypot(
      noseTip.x - detectionStateRef.current.lastNosePosition.x,
      noseTip.y - detectionStateRef.current.lastNosePosition.y
    );
    detectionStateRef.current.lastNosePosition = { x: noseTip.x, y: noseTip.y };
    const MOVEMENT_THRESHOLD = 0.02;
    console.log("Head movement detected:", movement);
    return movement > MOVEMENT_THRESHOLD;
  };

  // Handle face mesh results
  const handleFaceMeshResults = useCallback((results) => {
    console.log("FaceMesh results received:", !!results.multiFaceLandmarks);
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      detectionStateRef.current.faceDetected = false;
      detectionStateRef.current.consecutiveFrames = 0;
      detectionStateRef.current.lastNosePosition = null;
      console.log("No face detected");
      return;
    }

    detectionStateRef.current.consecutiveFrames++;
    detectionStateRef.current.faceDetected = detectionStateRef.current.consecutiveFrames > 5;

    if (detectionStateRef.current.faceDetected && !processingRef.current) {
      console.log("Face detected for", detectionStateRef.current.consecutiveFrames, "frames");

      const landmarks = results.multiFaceLandmarks[0];
      const LEFT_EYE = [33, 246, 161, 160, 159, 158, 157, 173];
      const RIGHT_EYE = [463, 414, 286, 258, 257, 259, 260, 467];

      const leftEye = LEFT_EYE.map(index => landmarks[index]);
      const rightEye = RIGHT_EYE.map(index => landmarks[index]);

      const leftEAR = calculateEAR(leftEye);
      const rightEAR = calculateEAR(rightEye);
      const avgEAR = (leftEAR + rightEAR) / 2;

      detectionStateRef.current.earHistory.push(avgEAR);
      if (detectionStateRef.current.earHistory.length > 10) {
        detectionStateRef.current.earHistory.shift();
      }

      const earAvg = detectionStateRef.current.earHistory.reduce((a, b) => a + b, 0) / 
                     detectionStateRef.current.earHistory.length;

      const now = Date.now();
      const EAR_THRESHOLD = isIPhone ? 0.4 : 0.4; // Relaxed for all devices
      const EAR_DIFF_THRESHOLD = isIPhone ? 0.02 : 0.02; // More sensitive
      const MIN_BLINK_INTERVAL = 1000;

      console.log("EAR values:", { leftEAR, rightEAR, avgEAR, earAvg });

      if (isIPhone) {
        const hasMovement = calculateHeadMovement(landmarks);
        if (hasMovement) {
          detectionStateRef.current.movementDetected = true;
          console.log("iPhone head movement detected");
        }
        if (detectionStateRef.current.consecutiveFrames >= 10 && detectionStateRef.current.movementDetected) {
          console.log("iPhone detected, capturing image after head movement");
          setIsLive(true);
          captureAndUpload();
        }
      } else {
        // Blink detection for Android and desktop
        if (avgEAR < EAR_THRESHOLD && earAvg - avgEAR > EAR_DIFF_THRESHOLD) {
          if (now - detectionStateRef.current.lastBlinkTime > MIN_BLINK_INTERVAL) {
            detectionStateRef.current.blinkCount++;
            detectionStateRef.current.lastBlinkTime = now;
            setIsLive(true);
            console.log(`${isAndroid ? "Android" : "Desktop"} blink detected, count:`, detectionStateRef.current.blinkCount);
            console.log(`${isAndroid ? "Android" : "Desktop"} detected, capturing image after blink`);
            captureAndUpload();
          }
        } else if (!isAndroid && detectionStateRef.current.consecutiveFrames >= 200) {
          // Fallback for desktop: head movement after ~10 seconds (200 frames at ~20 FPS)
          const hasMovement = calculateHeadMovement(landmarks);
          if (hasMovement) {
            detectionStateRef.current.movementDetected = true;
            console.log("Desktop head movement detected, capturing as fallback");
            setIsLive(true);
            captureAndUpload();
          }
        }
      }
    }
  }, [isIPhone, isAndroid]);

  const compressImage = useCallback(async (imageSrc) => {
    try {
      console.log("Compressing image");
      const img = new Image();
      img.src = imageSrc;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Image load failed"));
      });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");

      const maxWidth = isMobile ? 480 : 640;
      const maxHeight = isMobile ? 480 : 480;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              console.log("Image compressed successfully");
              resolve(blob);
            } else {
              reject(new Error("Canvas toBlob failed"));
            }
          },
          "image/jpeg",
          0.8
        );
      });
    } catch (err) {
      console.error("Image compression error:", err);
      throw new Error(`Image compression failed: ${err.message}`);
    }
  }, [isMobile]);

  const captureAndUpload = useCallback(async () => {
    if (processingRef.current) {
      console.log("Processing already in progress, skipping capture");
      return;
    }
    processingRef.current = true;

    try {
      console.log("Capturing and uploading image");
      setUploading(true);
      setError(null);
      setResult(null);

      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) throw new Error("Failed to capture image from webcam.");

      const blob = await compressImage(imageSrc);
      const fileName = `search/${uuidv4()}.jpg`;

      console.log("Uploading to S3:", fileName);
      await s3.upload({
        Bucket: "fjgroup-employee-authentication",
        Key: fileName,
        Body: blob,
        ContentType: "image/jpeg",
      }).promise();

      console.log("S3 upload successful, calling authentication API");
      const apiUrl = "https://ylj9f75xi9.execute-api.us-east-2.amazonaws.com/dev/authenticate";
      const response = await axios.post(
        apiUrl,
        {
          bucket: "fjgroup-employee-authentication",
          key: fileName,
        },
        { timeout: 3000 }
      );

      setResult(response.data);
      console.log("Authentication API response:", response.data);

      if (response.data.message === "Face matched") {
        console.log("Face matched, submitting form");
        setTimeout(() => {
          const form = document.createElement("form");
          form.method = "POST";
          form.action = "https://portal.fjtco.com:8444/fjhr/FaceLoginServlet";

          const input = document.createElement("input");
          input.type = "hidden";
          input.name = "employeeId";
          input.value = response.data.employeeId;

          form.appendChild(input);
          document.body.appendChild(form);
          form.submit();
        }, 500);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      setError(`Authentication failed: ${errorMsg}`);
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      processingRef.current = false;
      console.log("Capture and upload process completed");
    }
  }, [compressImage]);

  return (
    <Box sx={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      bgcolor: '#f5f5f5',
      p: isMobile ? 2 : 3,
    }}>
      <StyledPaper elevation={6}>
        <Typography
          variant={isMobile ? "h5" : "h4"}
          align="center"
          gutterBottom
          sx={{
            fontWeight: 'bold',
            color: '#1976d2',
            mb: isMobile ? 2 : 3,
            background: 'linear-gradient(to right, #1976d2, #42a5f5)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: isMobile ? '1.8rem' : '2.125rem',
          }}
        >
          Face Authentication
        </Typography>

        {modelsLoading && (
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <CircularProgress sx={{ color: '#1976d2' }} />
            <Typography sx={{ mt: 2, color: theme.palette.text.secondary }}>
              Loading face detection models...
            </Typography>
          </Box>
        )}

        <WebcamContainer>
          <Fade in={!webcamReady || modelsLoading}>
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: 'column',
                alignItems: "center",
                justifyContent: "center",
                background: "#000",
                zIndex: 10,
              }}
            >
              <CircularProgress sx={{ color: '#1976d2' }} />
              <Typography sx={{ mt: 2, color: '#fff', fontSize: isMobile ? '0.9rem' : '1rem' }}>
                {modelsLoading ? "Loading models..." : "Initializing webcam..."}
              </Typography>
            </Box>
          </Fade>

          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            videoConstraints={videoConstraints}
            onUserMedia={handleWebcamReady}
            onUserMediaError={(err) => {
              setError(`Webcam error: ${err.message}`);
              console.error("Webcam error:", err);
            }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
            }}
          />

          <canvas
            ref={canvasRef}
            style={{
              display: 'none', // Hide canvas as face mesh is not rendered
            }}
          />

          <Fade in={webcamReady && !modelsLoading}>
            <StatusOverlay>
              <Typography variant="body2" sx={{ fontSize: isMobile ? '0.8rem' : '0.875rem' }}>
                {uploading
                  ? "Processing authentication..."
                  : isIPhone
                    ? detectionStateRef.current.faceDetected
                      ? detectionStateRef.current.movementDetected
                        ? "Head movement detected, capturing image..."
                        : "Please move your head slightly"
                      : "Please position your face in the frame"
                    : isLive
                      ? "Blink detected! Authenticating..."
                      : detectionStateRef.current.faceDetected
                        ? "Please blink to authenticate"
                        : "Please position your face in the frame"}
              </Typography>
            </StatusOverlay>
          </Fade>
        </WebcamContainer>

        <Box sx={{ mt: 3, textAlign: "center" }}>
          {error && (
            <Fade in={!!error}>
              <Alert
                severity="error"
                sx={{ 
                  mb: 2, 
                  borderRadius: 2,
                  fontSize: isMobile ? '0.8rem' : '0.875rem',
                }}
                onClose={() => setError(null)}
              >
                {error}
              </Alert>
            </Fade>
          )}

          {result && (
            <Fade in={!!result}>
              <Alert
                severity={result.message === "Face matched" ? "success" : "warning"}
                sx={{ 
                  mb: 2, 
                  borderRadius: 2,
                  fontSize: isMobile ? '0.8rem' : '0.875rem',
                }}
              >
                {result.message}
              </Alert>
            </Fade>
          )}
        </Box>
      </StyledPaper>
    </Box>
  );
};

export default CameraCapture;