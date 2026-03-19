import React from 'react'
import {Link, useLocation} from 'react-router-dom'

const Navbar: React.FC = () => {
    const location = useLocation()
    
    const isActive = (path:string) : string =>{
        if (path === '/') {
      return location.pathname === '/'
        ? 'border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium'
        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium'
    }

    return location.pathname.startsWith(path)
      ? 'border-blue-500 text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium'
      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium'
  }

  return (
    <nav className="bg-white shadow-lg border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="shrink-0 flex items-center">
              <span className="font-bold text-xl text-gray-800 tracking-tight">
                Drive Testing <span className="text-blue-600">Tool</span>
              </span>
            </div>

              
                        {/* Navigation menu */}
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              <Link to="/" className={isActive('/')}>
                Add Building
              </Link>
              
              {/* Changed from to="/" to to="/outdoor" */}
              <Link to="/outdoor" className={isActive('/outdoor')}>
                Outdoor
              </Link>

              {/* Changed from to="/wireless" to to="/indoor" */}
              <Link to="/indoor" className={isActive('/indoor')}>
                Indoor
              </Link>
            </div>

          </div>
        </div>
      </div>
    </nav>
  )
}

export default Navbar