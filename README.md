# YouTube Transcript MCP Server

A high-performance, serverless implementation of a YouTube transcript extraction service using the Model Context Protocol (MCP), deployed on Cloudflare Workers.

**Live API Endpoint:** [https://youtube-transcript-mcp-server.ap-a98.workers.dev](https://youtube-transcript-mcp-server.ap-a98.workers.dev)

## Architecture

This implementation follows a minimalist, edge-optimized architecture leveraging Cloudflare Workers for maximum performance:

- **Serverless Execution**: Runs on Cloudflare's global edge network
- **MCP Protocol**: Implements the Model Context Protocol for standardized tool interactions
- **Dual Transport**: Supports both SSE streaming and direct JSON-RPC API calls
- **Optimized Response Times**: Typically 400-800ms response times

## Key Components

The server is built with a minimal, high-efficiency codebase (<300 lines):

1. **YouTubeTranscriptExtractor**: Core functionality for parsing YouTube URLs and fetching transcripts
2. **TranscriptServer**: MCP protocol implementation with SSE transport
3. **CloudflareResponseAdapter**: Bridge between Cloudflare's streams and Node.js-style response handling

## Technical Implementation

- **Transport Layer**: Uses SSEServerTransport instead of StdioServerTransport for HTTP-based operations
- **Streaming Support**: Implements Server-Sent Events (SSE) for stateful streaming connections
- **RPC Interface**: Direct JSON-RPC API for simple, stateless requests
- **Error Handling**: Comprehensive error handling with proper HTTP status codes

## Usage Examples

### JSON-RPC Direct Call

```bash
curl -X POST "https://youtube-transcript-mcp-server.ap-a98.workers.dev" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", 
    "id": "1",
    "method": "call_tool",
    "params": {
      "name": "get_transcript",
      "arguments": {
        "url": "https://www.youtube.com/watch?v=Ek8JHgZtmcI",
        "lang": "en"
      }
    }
  }'
```

### SSE Streaming Connection

For applications that need a streaming connection:

```javascript
// Client-side JavaScript
const eventSource = new EventSource('https://youtube-transcript-mcp-server.ap-a98.workers.dev');
eventSource.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // Process message
};

// Send initial message
fetch('https://youtube-transcript-mcp-server.ap-a98.workers.dev', {
  method: 'POST',
  headers: { 'Accept': 'text/event-stream' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: '1',
    method: 'call_tool',
    params: {
      name: 'get_transcript',
      arguments: {
        url: 'https://www.youtube.com/watch?v=Ek8JHgZtmcI',
        lang: 'en'
      }
    }
  })
});
```

## Performance Characteristics

- **Cold Start**: Minimal cold start times (~50ms) due to optimized code footprint
- **Transcript Processing**: Typical processing time of 400-800ms
- **Scalability**: Scales automatically with Cloudflare's infrastructure
- **Global Availability**: Deployed on Cloudflare's global edge network for low-latency access

## Implementation Details

The server leverages several optimizations to maintain high performance:

1. **Minimalist Code Structure**: <300 lines total implementation
2. **Edge-Optimized Patterns**: Uses TransformStream for efficient streaming
3. **Node.js Compatibility Mode**: Uses Cloudflare's nodejs_compat flag for library support
4. **Efficient Error Handling**: Quick fail paths with appropriate error codes

## Potential Enhancements

- Add caching layer to improve performance for frequently requested videos
- Implement transcript segmentation for very long videos
- Add support for additional languages with auto-detection
- Add request rate limiting and access controls

## Development and Deployment

Built for and deployed on Cloudflare Workers using:

```bash
# Development
wrangler dev

# Deployment
wrangler deploy
```

## Credits

- Uses [youtube-captions-scraper](https://github.com/algolia/youtube-captions-scraper) for transcript extraction
- Built with [@modelcontextprotocol/sdk](https://github.com/remoteprompt/modelcontextprotocol) 