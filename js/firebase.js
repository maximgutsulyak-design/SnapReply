import { state, persist } from './state.js';
import { $, toast } from './utils.js';
import { renderCategories, renderTemplateGrid, updateLogo } from './render.js';

let firebaseApp = null;
let firestore = null;
let auth = null;
let currentUser = null;
let authInProgress = false;

function showFirebaseProgress(message) {
  const status = $('firebaseStatus');
  if (status) status.textContent = message;
}

export function updateAccountUI() {
  const loginLabel = $('accountName');
  const emailLabel = $('firebaseUserName');
  const btnSync = $('sync_btn');
  if (!loginLabel) return;
  const signOutBtn = $('btnGoogleSignOut');
  const authBtn = $('auth_btn');
  if (currentUser) {
    loginLabel.textContent = currentUser.displayName || 'Вхід виконано';
    if (emailLabel) {
      emailLabel.textContent = currentUser.email || '';
      emailLabel.style.display = 'block';
    }
    if (btnSync) btnSync.textContent = 'Синхронізувати шаблони';
    if (signOutBtn) signOutBtn.style.display = 'inline-flex';
    if (authBtn) authBtn.style.display = 'none';
  } else {
    loginLabel.textContent = 'Не ввійшли';
    if (emailLabel) {
      emailLabel.textContent = '';
      emailLabel.style.display = 'none';
    }
    if (btnSync) btnSync.textContent = 'Увійти та синхронізувати';
    if (signOutBtn) signOutBtn.style.display = 'none';
    if (authBtn) authBtn.style.display = 'inline-flex';
  }
}

export async function initFirebase() {
  if (!window.firebase) {
    console.warn('Firebase бібліотека не завантажена.');
    showFirebaseProgress('Firebase бібліотека не завантажена. Синхронізація недоступна.');
    return;
  }
  
  const config = {
    apiKey: 'AIzaSyDQ6l0lujXwa179I9ZT4vLlBEtrpRtJZVw',
    authDomain: 'snapreply-eee27.firebaseapp.com',
    projectId: 'snapreply-eee27',
    storageBucket: 'snapreply-eee27.firebasestorage.app',
    messagingSenderId: '1082841587829',
    appId: '1:1082841587829:web:dd6e1b74c1cdb84d16d83c',
    measurementId: 'G-4LP81LMPQF'
  };

  console.log('Firebase init config', {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket
  });
  console.log('Firebase library loaded', !!window.firebase, typeof window.firebase?.initializeApp === 'function');
  
  const hasPlaceholders = Object.values(config).some(val => typeof val === 'string' && val.startsWith('YOUR_'));
  if (hasPlaceholders) {
    console.warn('Firebase не налаштовано. Будь ласка, вкажіть реальні облікові дані в firebase.js.');
    showFirebaseProgress('Firebase не налаштовано. Синхронізація недоступна.');
    return;
  }
  
  firebaseApp = window.firebase.initializeApp(config);
  try {
    firestore = window.firebase.firestore();
    firestore.settings({ merge: true });
  } catch (error) {
    console.warn('Firestore initialization failed:', error);
    showFirebaseProgress('Помилка ініціалізації Firestore. Перевірте налаштування Firebase.');
    return;
  }
  auth = window.firebase.auth();
  auth.onAuthStateChanged((user) => {
    currentUser = user;
    updateAccountUI();
    if (user) {
      showFirebaseProgress('Успішно підключено. Синхронізація готова.');
    } else {
      showFirebaseProgress('Не ввійшли. Натисніть кнопку для входу.');
    }
  });

  try {
    const redirectResult = await auth.getRedirectResult();
    if (redirectResult?.user) {
      currentUser = redirectResult.user;
      updateAccountUI();
      showFirebaseProgress('Авторизація через редирект пройшла успішно. Завантаження даних...');
      loadFromCloud();
    }
  } catch (error) {
    console.warn('Firebase redirect result failed:', error);
  }
}

export async function loginWithGoogle() {
  if (!window.firebase) {
    alert('Firebase не завантажено. Синхронізація недоступна.');
    return;
  }
  if (!auth) {
    await initFirebase();
  }
  if (!auth) {
    if (!window.firebase) {
      alert('Firebase бібліотека не завантажена. Перевірте підключення або доступ до CDN.');
    } else {
      alert('Firebase не налаштовано. Синхронізація недоступна.');
    }
    return;
  }
  if (authInProgress) {
    alert('Вхід уже виконується. Зачекайте, будь ласка.');
    return;
  }
  authInProgress = true;
  const provider = new window.firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then((result) => {
      authInProgress = false;
      const user = result?.user || auth.currentUser;
      if (user) {
        currentUser = user;
        updateAccountUI();
        showFirebaseProgress('Авторизація пройшла успішно. Завантаження даних...');
        loadFromCloud();
      } else {
        showFirebaseProgress('Авторизація пройшла, але користувача не знайдено.');
      }
    })
    .catch((error) => {
      authInProgress = false;
      console.warn('Popup signin error:', error);
      alert('Не вдалося виконати вхід: ' + (error.message || error.code));
    });
}

export function logoutFirebase() {
  if (!auth) return;
  auth.signOut().catch((error) => {
    console.warn(error);
  });
}

export async function saveToCloud() {
  if (!currentUser || !firestore) {
    loginWithGoogle();
    return;
  }
  try {
    showFirebaseProgress('Збереження даних у хмару...');
    try {
      await firestore.enableNetwork();
    } catch (networkError) {
      console.warn('Не вдалося увімкнути мережу Firestore:', networkError);
    }
    const payload = {
      templates: state.templates,
      categoryOrder: state.categoryOrder,
      updatedAt: Date.now(),
    };
    
    let retries = 3;
    let success = false;
    while (retries > 0 && !success) {
      try {
        await firestore.collection('snapreply').doc(currentUser.uid).set(payload, { merge: true });
        success = true;
        break;
      } catch (saveError) {
        if (saveError.message && saveError.message.includes('offline')) {
          retries--;
          if (retries > 0) {
            console.warn('Firestore offline, retrying save... (' + retries + ' retries left)');
            await new Promise(resolve => setTimeout(resolve, 1500));
            try {
              await firestore.enableNetwork();
            } catch (e) {
              console.warn('Network re-enable failed:', e);
            }
          } else {
            throw saveError;
          }
        } else {
          throw saveError;
        }
      }
    }
    
    if (success) {
      toast('Шаблони збережено у хмару.');
      showFirebaseProgress('Дані збережено.');
    }
  } catch (error) {
    console.warn(error);
    toast('Помилка збереження у хмару.');
    showFirebaseProgress('Не вдалося зберегти у хмару: ' + (error.message || error.code));
  }
}

export async function loadFromCloud() {
  if (!currentUser || !firestore) {
    loginWithGoogle();
    return;
  }
  try {
    showFirebaseProgress('Завантаження шаблонів з хмари...');
    try {
      await firestore.enableNetwork();
    } catch (networkError) {
      console.warn('Не вдалося увімкнути мережу Firestore:', networkError);
    }
    
    let retries = 3;
    let doc = null;
    while (retries > 0 && !doc) {
      try {
        doc = await firestore.collection('snapreply').doc(currentUser.uid).get();
        break;
      } catch (fetchError) {
        if (fetchError.message && fetchError.message.includes('offline')) {
          retries--;
          if (retries > 0) {
            console.warn('Firestore offline, retrying... (' + retries + ' retries left)');
            await new Promise(resolve => setTimeout(resolve, 1500));
            try {
              await firestore.enableNetwork();
            } catch (e) {
              console.warn('Network re-enable failed:', e);
            }
          } else {
            throw fetchError;
          }
        } else {
          throw fetchError;
        }
      }
    }
    
    if (!doc || !doc.exists) {
      showFirebaseProgress('У хмарі ще немає даних.');
      return;
    }
    const data = doc.data();
    if (!data || !Array.isArray(data.templates)) {
      showFirebaseProgress('Хмарні дані пошкоджені або невірні.');
      return;
    }
    state.templates = data.templates;
    if (Array.isArray(data.categoryOrder)) state.categoryOrder = data.categoryOrder;
    persist();
    renderCategories();
    renderTemplateGrid();
    toast('Шаблони завантажено з хмари.');
    showFirebaseProgress('Дані оновлено.');
  } catch (error) {
    console.warn(error);
    toast('Помилка завантаження з хмари.');
    showFirebaseProgress('Не вдалося завантажити хмарні дані: ' + (error.message || error.code));
  }
}

export function handleCloudButton() {
  if (!currentUser) {
    loginWithGoogle();
    return;
  }
  const action = confirm('Натисніть OK для збереження локальних шаблонів у хмару або Скасувати для завантаження шаблонів з хмари.');
  if (action) {
    saveToCloud();
  } else {
    loadFromCloud();
  }
}

export async function saveBackgroundToCloud(backgroundUrl) {
  if (!currentUser || !firestore) {
    console.warn('Користувач не авторизований. Фон не збережено у хмару.');
    return false;
  }
  
  if (!backgroundUrl) {
    return deleteBackgroundFromCloud();
  }
  
  try {
    await firestore.collection('users').doc(currentUser.uid).set({
      backgroundImage: backgroundUrl,
      backgroundUpdatedAt: new Date().toISOString()
    }, { merge: true });
    console.log('✅ Фон збережено у хмару');
    return true;
  } catch (error) {
    console.error('❌ Помилка при збереженні фону у хмару:', error);
    return false;
  }
}

export async function loadBackgroundFromCloud() {
  if (!currentUser || !firestore) {
    console.warn('Користувач не авторизований.');
    return null;
  }
  
  try {
    const doc = await firestore.collection('users').doc(currentUser.uid).get();
    if (doc.exists && doc.data().backgroundImage) {
      console.log('✅ Фон завантажено з хмари');
      return doc.data().backgroundImage;
    }
    return null;
  } catch (error) {
    console.error('❌ Помилка при завантаженні фону з хмари:', error);
    return null;
  }
}

export async function deleteBackgroundFromCloud() {
  if (!currentUser || !firestore) return false;
  
  try {
    await firestore.collection('users').doc(currentUser.uid).set({
      backgroundImage: null
    }, { merge: true });
    console.log('✅ Фон видалено з хмари');
    return true;
  } catch (error) {
    console.error('❌ Помилка при видаленні фону з хмари:', error);
    return false;
  }
}
