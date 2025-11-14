const admin = require('firebase-admin');
const path = require('path');

try {
  // Đường dẫn đến service account key từ Firebase Console
  // Bạn cần tải file JSON này từ Firebase Console > Project Settings > Service Accounts
  const serviceAccount = require(path.join(__dirname, 'ecare-7896e-firebase-adminsdk-fbsvc-22e0164edd.json'));
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  console.log('✅ Firebase Admin initialized successfully');
} catch (error) {
  console.error('❌ Firebase Admin initialization error:', error.message);
  console.log('⚠️  Please add ecare-7896e-firebase-adminsdk-fbsvc-22e0164edd.json to Backend/src/config/ directory');
}

module.exports = admin;