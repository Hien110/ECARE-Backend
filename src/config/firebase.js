const admin = require('firebase-admin');

let serviceAccount;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    // đọc từ biến môi trường (Azure)
    serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n')
    );
  } else {
    // fallback khi chạy local
    serviceAccount = require('./ecare-7896e-firebase-adminsdk-fbsvc.json');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log('🔥 Firebase Admin initialized');
} catch (err) {
  console.error('❌ Firebase init error:', err);
}

module.exports = admin;
