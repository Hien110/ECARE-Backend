const admin = require('firebase-admin');
const path = require('path');

try {
  // Kiểm tra xem Firebase đã được khởi tạo chưa
  if (!admin.apps.length) {
    let credential;
    
    // Production: Sử dụng environment variables
    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID) {
      credential = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Replace \\n với \n để private key được format đúng
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      });
      console.log('🔐 Using Firebase credentials from environment variables');
    } 
    // Development: Sử dụng file JSON local
    else {
      const serviceAccount = require(path.join(__dirname, 'ecare-7896e-firebase-adminsdk-fbsvc-22e0164edd.json'));
      credential = admin.credential.cert(serviceAccount);
      console.log('📁 Using Firebase credentials from local file');
    }
    
    admin.initializeApp({ credential });
    
    console.log('✅ Firebase Admin initialized successfully');
  } else {
    console.log('ℹ️  Firebase Admin already initialized');
  }
} catch (error) {
  console.error('❌ Firebase Admin initialization error:', error.message);
  console.log('⚠️  Please check your Firebase configuration (environment variables or service account file)');
}

module.exports = admin;