import React, { useState } from 'react';

const Homepage = () => {
  const [result, setResult] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    const jsonInput = document.getElementById('jsonInput').value;

    try {
      const jsonData = JSON.parse(jsonInput);
      setResult('⏳ Sending request...');
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonData),
      });

      if (response.ok) {
        setResult('✅ Order submitted successfully');
      } else {
        setResult('❌ Error submitting order');
      }
    } catch (error) {
      setResult('❌ Invalid JSON. Please check your input.');
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea id="jsonInput" rows="10" placeholder='{"key": "value"}'></textarea>
        <button type="submit">Submit</button>
      </form>
      <div>{result}</div>
    </div>
  );
};

export default Homepage;