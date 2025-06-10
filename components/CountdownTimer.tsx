import React, { useEffect, useState } from "react";

interface CountdownTimerProps {
  seconds: number;
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ seconds }) => {
  const [timeLeft, setTimeLeft] = useState(seconds);

  useEffect(() => {
    if (timeLeft === 0) return;
    const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft]);

  return <span>{timeLeft} seconds left</span>;
};

export default CountdownTimer;