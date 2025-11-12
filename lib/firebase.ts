/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDPZkWvtikPzDYCWNdxBw6tT0neHWkg0HQ",
  authDomain: "experiment-chesspuzzlesc-b6d6c.firebaseapp.com",
  projectId: "experiment-chesspuzzlesc-b6d6c",
  storageBucket: "experiment-chesspuzzlesc-b6d6c.firebasestorage.app",
  messagingSenderId: "337452946656",
  appId: "1:337452946656:web:8a60d3e46b90df849b6c85",
  measurementId: "G-KWHZB2MVWG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export const analytics = getAnalytics(app);
