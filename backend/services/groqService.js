/**
 * Centralized Groq API Integration Service
 */

/**
 * Sends a chat completion request to Groq with retry and timeout protections.
 * @param {string} systemPrompt - System context guidelines
 * @param {string} userPrompt - Contextual data & prompt instructions
 * @param {number} retries - Number of retry attempts (default: 3)
 * @param {number} delay - Base exponential backoff delay in ms (default: 500)
 * @returns {Promise<Object>} JSON response from the model
 */
const callGroq = async (systemPrompt, userPrompt, retries = 3, delay = 500) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const payload = {
    model: 'llama3-8b-8192',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout limit

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API returned HTTP ${response.status}: ${errorText}`);
      }

      const responseData = await response.json();
      const content = responseData.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from Groq API');
      }

      const parsedData = JSON.parse(content);
      return parsedData;
    } catch (error) {
      clearTimeout(timeoutId);
      console.warn(`[GroqService] Attempt ${attempt} failed: ${error.message}`);
      
      if (attempt === retries) {
        throw error;
      }
      
      // Wait for backoff delay before retrying
      const sleepTime = delay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, sleepTime));
    }
  }
};

module.exports = {
  callGroq
};
