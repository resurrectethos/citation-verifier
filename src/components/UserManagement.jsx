import React, { useState, useEffect } from 'react';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [newLimit, setNewLimit] = useState('');
  const [newUserList, setNewUserList] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const adminSecret = localStorage.getItem('admin_secret');
      if (!adminSecret) throw new Error('Admin secret not found.');

      const response = await fetch('/admin/users', {
        headers: { 'X-Admin-Token': adminSecret },
      });

      if (!response.ok) throw new Error(`Failed to fetch users: ${response.statusText}`);

      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDelete = async (userName) => {
    if (!window.confirm(`Are you sure you want to delete user: ${userName}?`)) return;

    try {
      const adminSecret = localStorage.getItem('admin_secret');
      const response = await fetch(`/admin/users/${userName}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': adminSecret },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete user.');
      }

      setUsers(users.filter(u => u.name !== userName));
      alert(`User ${userName} deleted successfully.`);
    } catch (err) {
      setError(err.message);
      alert(`Failed to delete user: ${err.message}`);
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user.name);
    setNewLimit(user.limit);
  };

  const handleCancel = () => {
    setEditingUser(null);
    setNewLimit('');
  };

  const handleSave = async (userName) => {
    try {
      const adminSecret = localStorage.getItem('admin_secret');
      const response = await fetch(`/admin/update-limit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminSecret,
        },
        body: JSON.stringify({ user: userName, limit: parseInt(newLimit, 10) }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update limit.');
      }

      setUsers(users.map(u => u.name === userName ? { ...u, limit: parseInt(newLimit, 10) } : u));
      handleCancel();
      alert(`User ${userName}'s limit updated successfully.`);
    } catch (err) {
      setError(err.message);
      alert(`Failed to update limit: ${err.message}`);
    }
  };

  const handleAddUsers = async (e) => {
    e.preventDefault();
    if (!newUserList.trim()) {
      alert('Please enter a list of users to add.');
      return;
    }

    try {
      const adminSecret = localStorage.getItem('admin_secret');
      const formData = new FormData();
      const userBlob = new Blob([newUserList], { type: 'text/plain' });
      formData.append('userFile', userBlob, 'users.txt');

      const response = await fetch('/admin/upload-users', {
        method: 'POST',
        headers: {
          'X-Admin-Token': adminSecret,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to add users.');
      }

      const result = await response.json();
      alert(result.message);
      setNewUserList('');
      fetchUsers(); // Refresh the user list
    } catch (err) {
      setError(err.message);
      alert(`Failed to add users: ${err.message}`);
    }
  };

  if (loading) return <div>Loading users...</div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Add New Users</h2>
        <form onSubmit={handleAddUsers} className="p-4 bg-white dark:bg-base-200 rounded-lg shadow">
          <label htmlFor="userList" className="block text-sm font-medium text-gray-700 dark:text-neutral-content">User List</label>
          <textarea
            id="userList"
            rows={4}
            value={newUserList}
            onChange={(e) => setNewUserList(e.target.value)}
            className="mt-1 block w-full p-2 border rounded-md shadow-sm dark:bg-base-100"
            placeholder="Paste a list of user names, separated by commas or new lines..."
          />
          <button type="submit" className="mt-4 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90">
            Add Users
          </button>
        </form>
      </div>

      <h2 className="text-xl font-semibold mb-4">Manage Existing Users</h2>
      <div className="overflow-x-auto bg-white dark:bg-base-200 rounded-lg shadow">
        <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-base-300">
          <thead className="bg-gray-50 dark:bg-base-300">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-content uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-content uppercase tracking-wider">Usage / Limit</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-neutral-content uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-base-200 divide-y divide-gray-200 dark:divide-base-300">
            {users.map((user) => (
              <tr key={user.name}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{user.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-neutral-content">
                  {editingUser === user.name ? (
                    <input 
                      type="number"
                      value={newLimit}
                      onChange={(e) => setNewLimit(e.target.value)}
                      className="w-20 p-1 border rounded dark:bg-base-100"
                    />
                  ) : (
                    <span>{user.analyses} / {user.limit}</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  {editingUser === user.name ? (
                    <>
                      <button onClick={() => handleSave(user.name)} className="text-green-600 hover:text-green-900">Save</button>
                      <button onClick={handleCancel} className="text-gray-600 hover:text-gray-900 ml-4">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => handleEdit(user)} className="text-indigo-600 hover:text-indigo-900 dark:text-primary dark:hover:text-primary/80">Edit Limit</button>
                      <button onClick={() => handleDelete(user.name)} className="text-red-600 hover:text-red-900 ml-4">Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UserManagement;