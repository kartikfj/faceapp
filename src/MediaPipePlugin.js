import fs from 'fs';
import path from 'path';

function MediaPipePlugin() {
  return {
    name: 'mediapipe-workaround',
    load(id) {
      // Patch face_mesh.js
      if (path.basename(id) === 'face_mesh.js') {
        let code = fs.readFileSync(id, 'utf-8');
        code += '\nexports.FaceMesh = FaceMesh;';
        return { code };
      }
      // Patch camera_utils.js
      if (path.basename(id) === 'camera_utils.js') {
        let code = fs.readFileSync(id, 'utf-8');
        code += '\nexports.Camera = Camera;';
        return { code };
      }
      return null;
    },
  };
}

export default MediaPipePlugin;