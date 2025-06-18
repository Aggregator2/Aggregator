import { useState, useCallback, ReactNode } from 'react';
import Toast, { ToastType } from '../components/Toast';

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration = 5000) => {
    const id = Date.now().toString();
    const newToast: ToastMessage = { id, message, type, duration };
    
    setToasts(prev => [...prev, newToast]);
    
    return id;
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const showSuccess = useCallback((message: string, duration?: number) => 
    showToast(message, 'success', duration), [showToast]);
  
  const showError = useCallback((message: string, duration?: number) => 
    showToast(message, 'error', duration), [showToast]);
  
  const showWarning = useCallback((message: string, duration?: number) => 
    showToast(message, 'warning', duration), [showToast]);
  
  const showInfo = useCallback((message: string, duration?: number) => 
    showToast(message, 'info', duration), [showToast]);

  const ToastContainer = useCallback((): ReactNode => (
    <>
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          isVisible={true}
          onClose={() => hideToast(toast.id)}
          duration={toast.duration}
        />
      ))}
    </>
  ), [toasts, hideToast]);

  return {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    hideToast,
    ToastContainer,
  };
}
