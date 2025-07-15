import React, { useState } from "react";
import axios from "axios";
import AWS from "aws-sdk";
import { v4 as uuidv4 } from "uuid";
import CameraCapture from "./CameraCapture";
//import LivenessTest from "./LivenessTest";
// import { Amplify } from 'aws-amplify';
// import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";
// import "@aws-amplify/ui-react-liveness/styles.css"; // ✅ Correct path
// import awsExports from './aws-exports';
// Amplify.configure(awsExports);
// Configure AWS SDK (use environment variables or IAM roles)
AWS.config.update({
  accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  region: "us-east-1",
});

const s3 = new AWS.S3();
const App = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFileChange = (event) => {
    const selectedFile = event.target.files[0];
    if (selectedFile && ["image/jpeg", "image/png", "image/jpg"].includes(selectedFile.type)) {
      setFile(selectedFile);
      setError(null);
      console.log(`[INFO] Selected file: ${selectedFile.name}`);
    } else {
      setFile(null);
      setError("Please select a valid image file (JPEG, JPG, or PNG)");
      console.error("[ERROR] Invalid file type selected");
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError("No file selected");
      console.error("[ERROR] No file selected for upload");
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      // Generate unique file name
      const fileName = `search/${uuidv4()}-${file.name}`;
      console.log(`[INFO] Uploading image: ${fileName} to S3`);

      // Upload to S3
      await s3
        .upload({
          Bucket: "fjgroup-employee-authentication",
          Key: fileName,
          Body: file,
          ContentType: file.type,
        })
        .promise();

      console.log(`[SUCCESS] Image uploaded: ${fileName}`);

      // Call API Gateway to trigger face matching
      const apiUrl = "https://ylj9f75xi9.execute-api.us-east-2.amazonaws.com/dev/authenticate";
      console.log(`[INFO] Sending request to API Gateway for image: ${fileName}`);
      const response = await axios.post(apiUrl, {
        bucket: "fjgroup-employee-authentication",
        key: fileName,
      });

      console.log("[SUCCESS] API Gateway response:", response.data);
      console.log("hi");
      if (response.data.message === "Face matched") {
//   const formData = new URLSearchParams();
// formData.append("employeeId", response.data.employeeId);

// await axios.post("http://10.10.4.132:8080/FJPORTAL_DEV/FaceLoginServlet", formData, {
//   withCredentials: true,
//   headers: {
//     "Content-Type": "application/x-www-form-urlencoded"
//   }
// });

 const form = document.createElement("form");
  form.method = "POST";
  form.action = "http://10.10.4.132:8080/FJPORTAL_DEV/FaceLoginServlet"; // or production URL

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "employeeId";
  input.value = response.data.employeeId;

  form.appendChild(input);
  document.body.appendChild(form);
  form.submit(); // Browser submits the form (no CORS issue)
  // Redirect to JSP home
// window.location.href = "http://10.10.4.132:8080/FJPORTAL_DEV/homepage.jsp";
 //window.location.href = "https://portal.fjtco.com:8444/fjhr/homepage.jsp";

}

      setResult(response.data);
    } catch (err) {
      console.error("[ERROR] Upload or processing failed:", err);
      setError(`Failed to process image: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
     {/* <LivenessTest />  */}
      <CameraCapture /> 
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4 text-center">Employee Face Authentication</h2>
      <div className="flex flex-col items-center space-y-4">
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png"
          onChange={handleFileChange}
          className="border border-gray-300 rounded p-2 w-full"
        />
        <button
          onClick={handleUpload}
          disabled={uploading || !file}
          className={`w-full py-2 px-4 rounded text-white ${
            uploading || !file ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {uploading ? "Processing..." : "Upload and Authenticate"}
        </button>
      </div>
      {error && <p className="mt-4 text-red-600 text-center">{error}</p>}
      {result && (
        <div className="mt-6 p-4 border border-gray-200 rounded">
          <h3 className="text-lg font-semibold">Authentication Result</h3>
          {result.message === "Face matched" ? (
            <div className="mt-2">
              <p className="text-green-600">Message: {result.message}</p>
              <p><strong>Employee ID:</strong> {result.employeeId}</p>
              <p><strong>Confidence:</strong> {result.confidence}%</p>
              <p><strong>Face ID:</strong> {result?.faceId || "N/A"}</p>
            </div>
          ) : (
            <p className="text-red-600">{result.message || "Unknown error"}</p>
          )}
        </div>
      )}
    </div>
 </> );
};

export default App;