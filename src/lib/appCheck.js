import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: "AIzaSyCUKmRYeRIBcn5uKoOvfsuBkTBdXIoRM3k",
  authDomain: "arkonomy-b3f41.firebaseapp.com",
  projectId: "arkonomy-b3f41",
  storageBucket: "arkonomy-b3f41.firebasestorage.app",
  messagingSenderId: "426653319853",
  appId: "1:426653319853:web:55124f9464c214ef157c24"
};

const firebaseApp = initializeApp(firebaseConfig);

export const appCheck = initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaV3Provider('6LdPuDUtAAAAAKEXljCJiVfM80VNsjQlZEMHfL-A'),
  isTokenAutoRefreshEnabled: true
});

export async function getAppCheckToken() {
  try {
    const { token } = await getToken(appCheck);
    return token;
  } catch (err) {
    console.error('App Check token error:', err);
    return null;
  }
}
