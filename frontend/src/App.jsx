import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import RoomLogin from './pages/room/Login';
import RoomLayout from './pages/room/Layout';
import RoomReporters from './pages/room/Reporters';
import RoomLiveStreams from './pages/room/LiveStreams';
import RoomUploads from './pages/room/Uploads';
import RoomAlerts from './pages/room/Alerts';
import RoomStories from './pages/room/Stories';
import AdminLogin from './pages/admin/Login';
import AdminLayout from './pages/admin/Layout';
import AdminReporters from './pages/admin/Reporters';
import AdminEditors from './pages/admin/Editors';
import AdminQueueHealth from './pages/admin/QueueHealth';
import { getToken as getRoomToken } from './roomApi';
import { getAdminToken } from './adminApi';

function ProtectedRoute({ children }) {
  const { reporter, loading } = useAuth();
  if (loading) return <div className="app-loading">Loading…</div>;
  if (!reporter) return <Navigate to="/login" replace />;
  return children;
}

function RoomProtected({ children }) {
  if (!getRoomToken()) return <Navigate to="/room/login" replace />;
  return children;
}

function AdminProtected({ children }) {
  if (!getAdminToken()) return <Navigate to="/admin/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Reporter portal */}
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Newsroom dashboard (editor) */}
      <Route path="/room/login" element={<RoomLogin />} />
      <Route path="/room" element={<RoomProtected><RoomLayout /></RoomProtected>}>
        <Route index element={<Navigate to="reporters" replace />} />
        <Route path="reporters" element={<RoomReporters />} />
        <Route path="live" element={<RoomLiveStreams />} />
        <Route path="uploads" element={<RoomUploads />} />
        <Route path="alerts" element={<RoomAlerts />} />
        <Route path="stories" element={<RoomStories />} />
      </Route>

      {/* Admin panel */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminProtected><AdminLayout /></AdminProtected>}>
        <Route index element={<Navigate to="reporters" replace />} />
        <Route path="reporters" element={<AdminReporters />} />
        <Route path="editors" element={<AdminEditors />} />
        <Route path="queue-health" element={<AdminQueueHealth />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
