import React, { useRef, useState, useEffect, useCallback } from "react";
import Webcam from "react-webcam";
import AWS from "aws-sdk";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import * as faceapi from "face-api.js";
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
  border: '2px solid #e0e0e074',
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
  
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const processingRef = useRef(false);
  const frameAnalyzerRef = useRef({
    prevFrameData: null,
    lastBlinkTime: 0,
    animationFrame: null,
    faceDetected: false,
    faceDetectionCount: 0,
    modelsLoaded: false,
  });

  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);

  const videoConstraints = {
    width: { ideal: isMobile ? 480 : 640 },
    height: { ideal: isMobile ? 480 : 480 },
    facingMode: "user",
  };

  // Load face-api.js models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = process.env.PUBLIC_URL + '/models';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        frameAnalyzerRef.current.modelsLoaded = true;
        setModelsLoading(false);
        console.log("Face detection models loaded successfully");
      } catch (err) {
        console.error("Failed to load face detection models:", err);
        setError("Failed to initialize face detection. Please refresh the page.");
        setModelsLoading(false);
      }
    };

    loadModels();
  }, []);

  const handleWebcamReady = useCallback(() => {
    setWebcamReady(true);
    console.log("Webcam initialized successfully");
  }, []);


  const compressImage = useCallback(async (imageSrc) => {
    try {
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
            if (blob) resolve(blob);
            else reject(new Error("Canvas toBlob failed"));
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
      console.log("Capture in progress, skipping");
      return;
    }
    processingRef.current = true;

    if (!webcamRef.current?.getScreenshot) {
      setError("Webcam is not ready. Please try again.");
      console.error("Webcam not ready for capture");
      processingRef.current = false;
      return;
    }

    let imageSrc;
    try {
      imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) {
        throw new Error("Failed to capture image from webcam.");
      }
    } catch (err) {
      setError(err.message);
      console.error("Capture error:", err);
      processingRef.current = false;
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const blob = await compressImage(imageSrc);
      const fileName = `search/${uuidv4()}.jpg`;

      await s3
        .upload({
          Bucket: "fjgroup-employee-authentication",
          Key: fileName,
          Body: blob,
          ContentType: "image/jpeg",
        })
        .promise();

      const apiUrl =
        "https://ylj9f75xi9.execute-api.us-east-2.amazonaws.com/dev/authenticate";
      const response = await axios.post(
        apiUrl,
        {
          bucket: "fjgroup-employee-authentication",
          key: fileName,
        },
        { timeout: 10000 }
      );

      setResult(response.data);

      if (response.data.message === "Face matched") {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "http://10.10.4.132:8080/FJPORTAL_DEV/FaceLoginServlet";
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "employeeId";
        input.value = response.data.employeeId;
        form.appendChild(input);
        document.body.appendChild(form);
        setTimeout(() => form.submit(), 1000);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      setError(`Authentication failed: ${errorMsg}`);
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      processingRef.current = false;
    }
  }, [compressImage]);

  const detectFace = async (video) => {
    if (!frameAnalyzerRef.current.modelsLoaded) return false;
    
    try {
      const detections = await faceapi.detectAllFaces(
        video,
        new faceapi.TinyFaceDetectorOptions()
      ).withFaceLandmarks();
      
      // Only proceed if exactly one face is detected
      if (detections.length === 1) {
        const landmarks = detections[0].landmarks;
        
        // Check if eyes are open (basic liveness check)
        const leftEye = landmarks.getLeftEye();
        const rightEye = landmarks.getRightEye();
        const eyeOpenness = getEyeOpenness(leftEye, rightEye);
        
        // Basic threshold for eye openness
        if (eyeOpenness > 0.2) {
          frameAnalyzerRef.current.faceDetectionCount++;
          
          // Require face to be detected in multiple consecutive frames
          if (frameAnalyzerRef.current.faceDetectionCount > 5) {
            return true;
          }
        } else {
          frameAnalyzerRef.current.faceDetectionCount = 0;
        }
      } else {
        frameAnalyzerRef.current.faceDetectionCount = 0;
      }
    } catch (err) {
      console.error("Face detection error:", err);
    }
    
    return false;
  };

  const getEyeOpenness = (leftEye, rightEye) => {
    // Calculate eye openness based on landmarks
    const leftEyeHeight = Math.abs(leftEye[1].y - leftEye[5].y);
    const rightEyeHeight = Math.abs(rightEye[1].y - rightEye[5].y);
    return (leftEyeHeight + rightEyeHeight) / 2;
  };

  const analyzeFrame = useCallback(async () => {
    if (
      !webcamRef.current?.video ||
      !canvasRef.current ||
      processingRef.current ||
      !webcamReady ||
      !frameAnalyzerRef.current.modelsLoaded
    ) {
      frameAnalyzerRef.current.animationFrame = requestAnimationFrame(analyzeFrame);
      return;
    }

    const video = webcamRef.current.video;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("Canvas context unavailable");
      frameAnalyzerRef.current.animationFrame = requestAnimationFrame(analyzeFrame);
      return;
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.log("Video dimensions not ready, skipping frame analysis");
      frameAnalyzerRef.current.animationFrame = requestAnimationFrame(analyzeFrame);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // First check for face presence
    const faceDetected = await detectFace(video);
    setFaceDetected(faceDetected);
    
    if (!faceDetected) {
      frameAnalyzerRef.current.animationFrame = requestAnimationFrame(analyzeFrame);
      return;
    }

    // Then proceed with blink detection
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const eyeRegion = {
      x: canvas.width * 0.3,
      y: canvas.height * 0.3,
      width: canvas.width * 0.4,
      height: canvas.height * 0.2,
    };

    let difference = 0;
    if (frameAnalyzerRef.current.prevFrameData) {
      const prevData = frameAnalyzerRef.current.prevFrameData;
      for (let y = eyeRegion.y; y < eyeRegion.y + eyeRegion.height; y++) {
        for (let x = eyeRegion.x; x < eyeRegion.x + eyeRegion.width; x++) {
          const idx = (y * canvas.width + x) * 4;
          const rDiff = Math.abs(data[idx] - prevData[idx]);
          const gDiff = Math.abs(data[idx + 1] - prevData[idx + 1]);
          const bDiff = Math.abs(data[idx + 2] - prevData[idx + 2]);
          difference += (rDiff + gDiff + bDiff) / 3;
        }
      }
      difference /= eyeRegion.width * eyeRegion.height;
    }

    frameAnalyzerRef.current.prevFrameData = new Uint8ClampedArray(data);

    const now = Date.now();
    const blinkThreshold = 30;
    const minBlinkInterval = 1000;

    if (
      difference > blinkThreshold &&
      now - frameAnalyzerRef.current.lastBlinkTime > minBlinkInterval
    ) {
      console.log("Blink detected, difference:", difference);
      frameAnalyzerRef.current.lastBlinkTime = now;
      setBlinkDetected(true);
      setIsLive(true);
      captureAndUpload();
    }

    frameAnalyzerRef.current.animationFrame = requestAnimationFrame(analyzeFrame);
  }, [captureAndUpload, webcamReady]);

  useEffect(() => {
    if (webcamReady && !modelsLoading) {
      frameAnalyzerRef.current = {
        prevFrameData: null,
        lastBlinkTime: 0,
        animationFrame: null,
        faceDetected: false,
        faceDetectionCount: 0,
        modelsLoaded: true,
      };
      frameAnalyzerRef.current.animationFrame = requestAnimationFrame(analyzeFrame);
    }

    return () => {
      if (frameAnalyzerRef.current?.animationFrame) {
        cancelAnimationFrame(frameAnalyzerRef.current.animationFrame);
      }
    };
  }, [webcamReady, analyzeFrame, modelsLoading]);

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
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              display: "none",
            }}
          />

          <Fade in={webcamReady && !modelsLoading}>
            <StatusOverlay>
              <Typography variant="body2" sx={{ fontSize: isMobile ? '0.8rem' : '0.875rem' }}>
                {uploading
                  ? "Processing authentication..."
                  : isLive
                    ? "Blink detected! Authenticating..."
                    : faceDetected
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