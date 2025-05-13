document.getElementById("submitButton").addEventListener("click", async function () {
  const textarea = document.getElementById("jsonInput");
  const resultBox = document.getElementById("resultBox");

  try {
    const jsonData = JSON.parse(textarea.value);
    resultBox.innerText = "⏳ Sending request...";
    resultBox.style.color = "gray";

    try {
      const response = await fetch("/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(jsonData),
      });

      if (response.ok) {
        const result = await response.json();
        resultBox.innerText = `✅ Order submitted successfully`;
        resultBox.style.color = "green";
      } else {
        const error = await response.json();
        resultBox.innerText = `❌ Error: ${error.message}`;
        resultBox.style.color = "red";
      }
    } catch (error) {
      resultBox.innerText = "❌ Failed to send request. Please try again.";
      resultBox.style.color = "red";
    }
  } catch (error) {
    resultBox.textContent = "Invalid JSON. Please check your input.";
    resultBox.style.color = "red";
  }
});