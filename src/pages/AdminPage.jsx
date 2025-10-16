import React from 'react';
import AdminLayout from '../components/AdminLayout';
import UserManagement from '../components/UserManagement';

const AdminPage = () => {
  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <header className="pb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
          </header>
          <main>
            <UserManagement />
          </main>
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminPage;
