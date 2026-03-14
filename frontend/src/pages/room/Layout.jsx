import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import * as roomApi from '../../roomApi';
import './Layout.css';

export default function Layout() {
  const navigate = useNavigate();
  const isAdmin = roomApi.getRole() === 'admin';

  function handleLogout() {
    roomApi.setToken(null);
    navigate('/room/login', { replace: true });
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2 className="sidebar-title">Newsroom</h2>
        <nav className="sidebar-nav">
          <NavLink to="reporters" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Reporters</NavLink>
          <NavLink to="live" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Live Streams</NavLink>
          <NavLink to="uploads" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Uploaded Clips</NavLink>
          {isAdmin && (
            <NavLink to="editors" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Add editor</NavLink>
          )}
        </nav>
        <button type="button" className="btn-logout" onClick={handleLogout}>Log out</button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
