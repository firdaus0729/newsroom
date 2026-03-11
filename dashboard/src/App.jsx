import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Layout from './pages/Layout';
import Reporters from './pages/Reporters';
import LiveStreams from './pages/LiveStreams';
import Uploads from './pages/Uploads';
import Editors from './pages/Editors';

function Protected({ children }) {
  const token = localStorage.getItem('dashboard_token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Layout /></Protected>}>
        <Route index element={<Navigate to="reporters" replace />} />
        <Route path="reporters" element={<Reporters />} />
        <Route path="live" element={<LiveStreams />} />
        <Route path="uploads" element={<Uploads />} />
        <Route path="editors" element={<Editors />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
