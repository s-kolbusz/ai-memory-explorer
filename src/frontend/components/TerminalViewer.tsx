import React from 'react';
import { motion } from 'framer-motion';
import { Terminal, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TerminalViewerProps {
  content: string;
}

export function TerminalViewer({ content }: TerminalViewerProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-md border border-border/40 overflow-hidden bg-background/50 my-2"
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/40">
        <div className="flex items-center text-xs font-medium text-muted-foreground">
          <Terminal className="w-3.5 h-3.5 mr-2 opacity-70" />
          Terminal Output
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-6 w-6 p-0 hover:bg-background"
          onClick={handleCopy}
        >
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
        </Button>
      </div>
      <div className="p-3 text-[11px] font-mono leading-relaxed text-muted-foreground max-h-[400px] overflow-y-auto">
        <pre className="whitespace-pre-wrap break-all">{content}</pre>
      </div>
    </motion.div>
  );
}
