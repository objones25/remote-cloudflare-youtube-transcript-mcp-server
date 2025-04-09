/**
 * YouTube Transcript MCP Server for Cloudflare Workers
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ErrorCode,
	McpError,
	Tool,
	CallToolResult
} from "@modelcontextprotocol/sdk/types.js";
// @ts-ignore
import { getSubtitles } from 'youtube-captions-scraper';

// Define tool configurations
const TOOLS: Tool[] = [
	{
		name: "get_transcript",
		description: "Extract transcript from a YouTube video URL or ID",
		inputSchema: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "YouTube video URL or ID"
				},
				lang: {
					type: "string",
					description: "Language code for transcript (e.g., 'ko', 'en')",
					default: "en"
				}
			},
			required: ["url", "lang"]
		}
	}
];

interface TranscriptLine {
	text: string;
	start: number;
	dur: number;
}

export interface Env {
	// Define any environment variables here if needed
}

/**
 * ServerResponse adapter for Cloudflare Workers
 * This allows us to use SSEServerTransport with Cloudflare Workers
 */
class CloudflareResponseAdapter {
	private writer: WritableStreamDefaultWriter<Uint8Array>;
	private encoder = new TextEncoder();
	private closeListeners: Array<() => void> = [];
	
	constructor(writer: WritableStreamDefaultWriter<Uint8Array>) {
		this.writer = writer;
	}
	
	writeHead(statusCode: number, headers: Record<string, string>): this {
		// Headers are already set in the Response object
		return this;
	}
	
	write(data: string): boolean {
		this.writer.write(this.encoder.encode(data)).catch(error => {
			console.error('Error writing to stream:', error);
		});
		return true;
	}
	
	end(): this {
		this.writer.close().catch(error => {
			console.error('Error closing writer:', error);
		});
		this.notifyClose();
		return this;
	}
	
	on(event: string, listener: () => void): this {
		if (event === 'close') {
			this.closeListeners.push(listener);
		}
		return this;
	}
	
	private notifyClose(): void {
		for (const listener of this.closeListeners) {
			try {
				listener();
			} catch (error) {
				console.error('Error in close listener:', error);
			}
		}
	}
}

class YouTubeTranscriptExtractor {
	/**
	 * Extracts YouTube video ID from various URL formats or direct ID input
	 */
	extractYoutubeId(input: string): string {
		if (!input) {
			throw new McpError(
				ErrorCode.InvalidParams,
				'YouTube URL or ID is required'
			);
		}

		// Handle URL formats
		try {
			const url = new URL(input);
			if (url.hostname === 'youtu.be') {
				return url.pathname.slice(1);
			} else if (url.hostname.includes('youtube.com')) {
				const videoId = url.searchParams.get('v');
				if (!videoId) {
					throw new McpError(
						ErrorCode.InvalidParams,
						`Invalid YouTube URL: ${input}`
					);
				}
				return videoId;
			}
		} catch (error) {
			// Not a URL, check if it's a direct video ID
			if (!/^[a-zA-Z0-9_-]{11}$/.test(input)) {
				throw new McpError(
					ErrorCode.InvalidParams,
					`Invalid YouTube video ID: ${input}`
				);
			}
			return input;
		}

		throw new McpError(
			ErrorCode.InvalidParams,
			`Could not extract video ID from: ${input}`
		);
	}

	/**
	 * Retrieves transcript for a given video ID and language
	 */
	async getTranscript(videoId: string, lang: string): Promise<string> {
		try {
			const transcript = await getSubtitles({
				videoID: videoId,
				lang: lang,
			});

			return this.formatTranscript(transcript);
		} catch (error) {
			console.error('Failed to fetch transcript:', error);
			throw new McpError(
				ErrorCode.InternalError,
				`Failed to retrieve transcript: ${(error as Error).message}`
			);
		}
	}

	/**
	 * Formats transcript lines into readable text
	 */
	private formatTranscript(transcript: TranscriptLine[]): string {
		return transcript
			.map(line => line.text.trim())
			.filter(text => text.length > 0)
			.join(' ');
	}
}

class TranscriptServer {
	private extractor: YouTubeTranscriptExtractor;
	private server: Server;

	constructor() {
		this.extractor = new YouTubeTranscriptExtractor();
		this.server = new Server(
			{
				name: "mcp-servers-youtube-transcript",
				version: "0.1.0",
			},
			{
				capabilities: {
					tools: {},
				},
			}
		);

		this.setupHandlers();
		this.setupErrorHandling();
	}

	private setupErrorHandling(): void {
		this.server.onerror = (error) => {
			console.error("[MCP Error]", error);
		};
	}

	private setupHandlers(): void {
		// List available tools
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: TOOLS
		}));

		// Handle tool calls
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => 
			this.handleToolCall(request.params.name, request.params.arguments ?? {})
		);
	}

	/**
	 * Handles tool call requests
	 */
	private async handleToolCall(name: string, args: any): Promise<{ toolResult: CallToolResult }> {
		switch (name) {
			case "get_transcript": {
				const { url: input, lang = "en" } = args;
				
				if (!input || typeof input !== 'string') {
					throw new McpError(
						ErrorCode.InvalidParams,
						'URL parameter is required and must be a string'
					);
				}

				if (lang && typeof lang !== 'string') {
					throw new McpError(
						ErrorCode.InvalidParams,
						'Language code must be a string'
					);
				}
				
				try {
					const videoId = this.extractor.extractYoutubeId(input);
					console.log(`Processing transcript for video: ${videoId}`);
					
					const transcript = await this.extractor.getTranscript(videoId, lang);
					console.log(`Successfully extracted transcript (${transcript.length} chars)`);
					
					return {
						toolResult: {
							content: [{
								type: "text",
								text: transcript,
								metadata: {
									videoId,
									language: lang,
									timestamp: new Date().toISOString(),
									charCount: transcript.length
								}
							}],
							isError: false
						}
					};
				} catch (error) {
					console.error('Transcript extraction failed:', error);
					
					if (error instanceof McpError) {
						throw error;
					}
					
					throw new McpError(
						ErrorCode.InternalError,
						`Failed to process transcript: ${(error as Error).message}`
					);
				}
			}

			default:
				throw new McpError(
					ErrorCode.MethodNotFound,
					`Unknown tool: ${name}`
				);
		}
	}

	/**
	 * Starts the SSE server with a given request
	 */
	async start(request: Request): Promise<Response> {
		// Create streaming for SSE
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		
		// Create response adapter for SSE
		const responseAdapter = new CloudflareResponseAdapter(writer);
		
		// Create response
		const response = new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
			}
		});
		
		try {
			// Create a unique endpoint for this connection
			const sessionId = crypto.randomUUID();
			const endpoint = `/sse-callback?sid=${sessionId}`;
			
			// Create SSE transport
			const transport = new SSEServerTransport(endpoint, responseAdapter as any);
			
			// Handle initial message if provided
			try {
				const initialMessage = await request.text();
				if (initialMessage && initialMessage.trim()) {
					await transport.handleMessage(JSON.parse(initialMessage));
				}
			} catch (error) {
				console.error('Error processing initial message:', error);
			}
			
			// Connect the server to the transport
			await this.server.connect(transport);
			
			return response;
		} catch (error) {
			console.error('Error starting SSE server:', error);
			return new Response(JSON.stringify({
				error: 'Failed to start SSE server'
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
	
	/**
	 * Handle direct JSON-RPC call
	 */
	async handleRPC(request: Request): Promise<Response> {
		try {
			const body = await request.text();
			const message = JSON.parse(body);
			
			// Handle RPC method
			if (message.method === 'list_tools') {
				return new Response(JSON.stringify({
					jsonrpc: '2.0',
					id: message.id,
					result: { tools: TOOLS }
				}), {
					headers: { 'Content-Type': 'application/json' }
				});
			} else if (message.method === 'call_tool' && message.params) {
				try {
					const toolName = message.params.name;
					const toolArgs = message.params.arguments || {};
					
					const toolResult = await this.handleToolCall(toolName, toolArgs);
					
					return new Response(JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						result: toolResult
					}), {
						headers: { 'Content-Type': 'application/json' }
					});
				} catch (error) {
					return new Response(JSON.stringify({
						jsonrpc: '2.0',
						id: message.id,
						error: (error instanceof McpError)
							? { code: error.code, message: error.message }
							: { code: ErrorCode.InternalError, message: 'Internal server error' }
					}), {
						status: error instanceof McpError ? 400 : 500,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			} else {
				return new Response(JSON.stringify({
					jsonrpc: '2.0',
					id: message.id,
					error: {
						code: ErrorCode.MethodNotFound,
						message: `Unknown method: ${message.method}`
					}
				}), {
					status: 404,
					headers: { 'Content-Type': 'application/json' }
				});
			}
		} catch (error) {
			return new Response(JSON.stringify({
				jsonrpc: '2.0',
				id: null,
				error: {
					code: ErrorCode.InternalError,
					message: 'Internal server error'
				}
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
	
	/**
	 * Stops the server
	 */
	async stop(): Promise<void> {
		try {
			await this.server.close();
		} catch (error) {
			console.error('Error while stopping server:', error);
		}
	}
}

// Create transcript server instance
const transcriptServer = new TranscriptServer();

// Export Cloudflare Worker fetch handler
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			// For SSE connections
			if (request.headers.get('accept') === 'text/event-stream') {
				return await transcriptServer.start(request);
			}
			
			// For JSON-RPC requests
			if (request.method === 'POST') {
				return await transcriptServer.handleRPC(request);
			}
			
			// Return API information for GET requests
			return new Response(JSON.stringify({
				name: "YouTube Transcript MCP Server",
				description: "An MCP server for extracting YouTube video transcripts",
				version: "0.1.0",
				tools: TOOLS
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			console.error('Unhandled server error:', error);
			return new Response(JSON.stringify({
				error: (error instanceof McpError)
					? { code: error.code, message: error.message }
					: { code: ErrorCode.InternalError, message: 'Internal server error' }
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
} satisfies ExportedHandler<Env>;
