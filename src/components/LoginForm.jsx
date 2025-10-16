import React, { useState } from 'react';

const LoginForm = () => {
  const [secret, setSecret] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (secret) {
      localStorage.setItem('admin_secret', secret);
      window.location.reload(); // Reload to trigger the auth check
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-base-100">
      <div className="p-8 bg-white dark:bg-base-200 rounded-lg shadow-lg w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">Admin Access</h1>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="secret" className="block text-sm font-medium text-gray-700 dark:text-neutral-content">Admin Secret</label>
            <input
              type="password"
              id="secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-white dark:bg-base-300 border border-gray-300 dark:border-base-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary"
              placeholder="Enter your admin secret"
            />
          </div>
          <button
            type="submit"
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
