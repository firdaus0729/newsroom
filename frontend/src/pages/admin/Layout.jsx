import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import * as adminApi from '../../adminApi';
import '../../pages/room/Layout.css';

export default function AdminLayout() {
  const navigate = useNavigate();

  function handleLogout() {
    adminApi.setAdminToken(null);
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2 className="sidebar-title">Admin</h2>
        <nav className="sidebar-nav">
          <NavLink to="reporters" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Reporters
          </NavLink>
          <NavLink to="editors" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Editors
          </NavLink>
        </nav>
        <button type="button" className="btn-logout" onClick={handleLogout}>
          Log out
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
