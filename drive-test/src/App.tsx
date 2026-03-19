import React from 'react'
import {Routes, Route} from 'react-router-dom'
import Home from './pages/home'
import Navbar from './component/Navbar'
import Wireless from './pages/Wireless'
import ThreeD from './pages/threeD'


const App: React.FC = () =>{
  return(
    <div>
      <Navbar/>
      <main className='main-content min-h-screen'>
        <Routes>
          <Route path='/outdoor' element={<Home/>}/>
          <Route path='/indoor' element={<Wireless/>}/>
          <Route path='/' element={<ThreeD/>}/>
        </Routes>
      </main>
    </div>
  )
}
export default App;