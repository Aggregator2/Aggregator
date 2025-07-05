import { useState, useEffect } from 'react';

export interface User {
  id: string;
  address: string;
  email?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

// Mock implementation - replace with actual auth logic
export const useAuth = () => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    token: null,
    loading: false,
    error: null
  });

  useEffect(() => {
    // Check for stored auth
    const storedToken = localStorage.getItem('authToken');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setAuthState({
        user: JSON.parse(storedUser),
        token: storedToken,
        loading: false,
        error: null
      });
    }
  }, []);

  const login = async (address: string) => {
    setAuthState(prev => ({ ...prev, loading: true, error: null }));

    try {
      // Mock authentication - replace with actual implementation
      const mockUser: User = {
        id: `user_${Date.now()}`,
        address
      };
      
      const mockToken = btoa(JSON.stringify({ userId: mockUser.id, address }));

      localStorage.setItem('authToken', mockToken);
      localStorage.setItem('user', JSON.stringify(mockUser));

      setAuthState({
        user: mockUser,
        token: mockToken,
        loading: false,
        error: null
      });

      return { user: mockUser, token: mockToken };
    } catch (error) {
      setAuthState({
        user: null,
        token: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Login failed'
      });
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    
    setAuthState({
      user: null,
      token: null,
      loading: false,
      error: null
    });
  };

  return {
    ...authState,
    login,
    logout,
    isAuthenticated: !!authState.user
  };
};