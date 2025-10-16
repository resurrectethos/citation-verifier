import React, { useState, useEffect } from 'react';
import LoginForm from './LoginForm';

const AdminLayout = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const secret = localStorage.getItem('admin_secret');
    // In a real app, you would validate this secret against the backend.
    // For now, we just check for its presence.
    if (secret) {
      setIsAuthenticated(true);
    }
  }, []);

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return <div>{children}</div>;
};

export default AdminLayout;
