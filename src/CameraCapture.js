import React, { useRef, useState, useEffect, useCallback } from "react";
import Webcam from "react-webcam";
import AWS from "aws-sdk";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { Box, CircularProgress, Alert, Typography, Paper, Fade } from "@mui/material";
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

const videoConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  facingMode: "user",
};

// Styled components
const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  borderRadius: 16,
  background: 'linear-gradient(145deg, #ffffff, #f0f0f0)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
  maxWidth: 720,
  margin: 'auto',
  overflow: 'hidden',
  transition: 'all 0.3s ease-in-out',
}));

const WebcamContainer = styled(Box)(({ theme }) => ({
  position: 'relative',
  width: 640,
  height: 480,
  margin: 'auto',
  borderRadius: 12,
  overflow: 'hidden',
  border: '2px solid #e0e0e0',
  background: '#000',
  transition: 'border-color 0.3s ease',
  '&:hover': {
    borderColor: theme.palette.primary.main,
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
}));

const CameraCapture = () => {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const processingRef = useRef(false);
  const frameAnalyzerRef = useRef({
    prevFrameData: null,
    lastBlinkTime: 0,
    animationFrame: null,
  });

  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [blinkDetected, setBlinkDetected] = useState(false);

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

      const maxWidth = 640;
      const maxHeight = 480;
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
  }, []);

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
        form.action="https://portal.fjtco.com:8444/fjhr/FaceLoginServlet";
      //  form.action = "http://10.10.4.132:8080/FJPORTAL_DEV/FaceLoginServlet";
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

  const analyzeFrame = useCallback(() => {
    if (
      !webcamRef.current?.video ||
      !canvasRef.current ||
      processingRef.current ||
      !webcamReady
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

    // Ensure video dimensions are valid
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.log("Video dimensions not ready, skipping frame analysis");
      frameAnalyzerRef.current.animationFrame = requestAnimationFrame(analyzeFrame);
      return;
    }

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Focus on eye region (approximate center of frame, adjust as needed)
    const eyeRegion = {
      x: canvas.width * 0.3,
      y: canvas.height * 0.3,
      width: canvas.width * 0.4,
      height: canvas.height * 0.2,
    };

    // Calculate difference from previous frame in eye region
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

    // Store current frame data
    frameAnalyzerRef.current.prevFrameData = new Uint8ClampedArray(data);

    // Blink detection logic
    const now = Date.now();
    const blinkThreshold = 30; // Adjust based on testing
    const minBlinkInterval = 1000; // 1 second cooldown

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
    if (webcamReady) {
      frameAnalyzerRef.current = {
        prevFrameData: null,
        lastBlinkTime: 0,
        animationFrame: null,
      };
      frameAnalyzerRef.current.animationFrame = requestAnimationFrame(analyzeFrame);
    }

    return () => {
      if (frameAnalyzerRef.current?.animationFrame) {
        cancelAnimationFrame(frameAnalyzerRef.current.animationFrame);
      }
    };
  }, [webcamReady, analyzeFrame]);

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', bgcolor: '#f5f5f5' }}>
      <StyledPaper elevation={6}>
        <Typography
          variant="h4"
          align="center"
          gutterBottom
          sx={{
            fontWeight: 'bold',
            color: '#1976d2',
            mb: 3,
            background: 'linear-gradient(to right, #1976d2, #42a5f5)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Face Authentication System
        </Typography>

        <WebcamContainer>
          <Fade in={!webcamReady}>
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
              <Typography sx={{ mt: 2, color: '#fff' }}>
                Initializing webcam...
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
              width: "100%",
              height: "100%",
              transform: 'scaleX(-1)', // Mirror the webcam feed
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
              display: "none", // Hidden canvas for analysis
            }}
          />

          <Fade in={webcamReady}>
            <StatusOverlay>
              <Typography variant="body2">
                {uploading
                  ? "Processing authentication..."
                  : isLive
                    ? "Blink detected! Authenticating..."
                    : "Please blink to authenticate"}
              </Typography>
            </StatusOverlay>
          </Fade>
        </WebcamContainer>

        <Box sx={{ mt: 3, textAlign: "center" }}>
          {error && (
            <Fade in={!!error}>
              <Alert
                severity="error"
                sx={{ mb: 2, borderRadius: 2 }}
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
                sx={{ mb: 2, borderRadius: 2 }}
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
