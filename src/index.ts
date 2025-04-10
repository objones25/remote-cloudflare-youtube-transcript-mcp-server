/**
 * YouTube Transcript MCP Server for Cloudflare Workers
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// @ts-ignore
import { getSubtitles } from 'youtube-captions-scraper';

export interface Env {
  // Durable Object namespace for MCP
  MCP_OBJECT: DurableObjectNamespace;
}

// Define our YouTube Transcript MCP Agent
export class YouTubeTranscriptMCPSqlite extends McpAgent<Env> {
  server = new McpServer({
    name: "YouTube Transcript MCP Server",
    version: "0.1.0",
  });

  private extractYoutubeId(input: string): string {
    if (!input) {
      throw new Error('YouTube URL or ID is required');
    }

    // Handle URL formats
    try {
      const url = new URL(input);
      if (url.hostname === 'youtu.be') {
        return url.pathname.slice(1);
      } else if (url.hostname.includes('youtube.com')) {
        const videoId = url.searchParams.get('v');
        if (!videoId) {
          throw new Error(`Invalid YouTube URL: ${input}`);
        }
        return videoId;
      }
    } catch (error) {
      // Not a URL, check if it's a direct video ID
      if (!/^[a-zA-Z0-9_-]{11}$/.test(input)) {
        throw new Error(`Invalid YouTube video ID: ${input}`);
      }
      return input;
    }

    throw new Error(`Could not extract video ID from: ${input}`);
  }

  private formatTranscript(transcript: Array<{ text: string; start: number; dur: number }>): string {
    return transcript
      .map(line => line.text.trim())
      .filter(text => text.length > 0)
      .join(' ');
  }

  async init() {
    console.error("YouTubeTranscriptMCPSqlite.init() called");
    
    // Register the getTranscript tool
    this.server.tool(
      "get_transcript", 
      { 
        url: z.string().describe("YouTube video URL or ID"),
        lang: z.string().default("en").describe("Language code for transcript (e.g., 'ko', 'en')")
      }, 
      async ({ url, lang }) => {
        try {
          const videoId = this.extractYoutubeId(url);
          console.error(`Processing transcript for video: ${videoId}`);
          
          const transcript = await getSubtitles({
            videoID: videoId,
            lang: lang || "en",
          });
          
          const formattedTranscript = this.formatTranscript(transcript);
          console.error(`Successfully extracted transcript (${formattedTranscript.length} chars)`);
          
          return {
            content: [{
              type: "text",
              text: formattedTranscript,
              metadata: {
                videoId,
                language: lang,
                timestamp: new Date().toISOString(),
                charCount: formattedTranscript.length
              }
            }],
            isError: false
          };
        } catch (error) {
          console.error('Transcript extraction failed:', error);
          
          return {
            content: [{
              type: "text",
              text: `Error: ${(error as Error).message}`
            }],
            isError: true
          };
        }
      }
    );
  }
}

// Get the handler directly from McpAgent.mount
const handler = YouTubeTranscriptMCPSqlite.mount('/sse', {
  binding: "MCP_OBJECT",
  corsOptions: {
    origin: "*",
    methods: "GET, POST, OPTIONS",
    headers: "Content-Type"
  }
});

// Export default handler for Cloudflare Workers
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      console.error(`Request received: ${request.method} ${new URL(request.url).pathname}`);
      
      // Handle basic HTTP requests
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(JSON.stringify({
          name: "YouTube Transcript MCP Server",
          description: "An MCP server for extracting YouTube video transcripts",
          version: "0.1.0",
          endpoint: "/sse"
        }), {
          headers: {
            'Content-Type': 'application/json',
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      
      // Type assertion is necessary due to the complex generic requirements of the handler
      // This converts the Env.MCP_OBJECT to the expected DurableObjectNamespace type
      const response = await handler.fetch(
        request, 
        { MCP_OBJECT: env.MCP_OBJECT } as unknown as Record<string, DurableObjectNamespace<any>>, 
        ctx
      );
      
      return response || new Response('No response from handler', { status: 500 });
      
    } catch (error) {
      console.error("Error handling request:", error);
      
      return new Response(`Internal Server Error: ${(error as Error).message}`, { 
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/plain"
        }
      });
    }
  }
};