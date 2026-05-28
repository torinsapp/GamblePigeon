import { Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import RoomPage from "./pages/RoomPage";

export default function App() {
  return (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:roomCode" element={<RoomPage />} />
      </Routes>
  );
}