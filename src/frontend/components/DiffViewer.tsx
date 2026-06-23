import React from 'react';
import { motion } from 'framer-motion';
import { FileCode2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DiffViewerProps {
  content: string;
}

export function DiffViewer({ content }: DiffViewerProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = content.split('\n');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-md border border-border/40 overflow-hidden bg-background/50 my-2"
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/40">
        <div className="flex items-center text-xs font-medium text-muted-foreground">
          <FileCode2 className="w-3.5 h-3.5 mr-2 opacity-70" />
          Code Modification
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
      <div className="overflow-x-auto p-3 text-[11px] font-mono leading-relaxed max-h-[400px] overflow-y-auto">
        <table className="w-full border-spacing-0">
          <tbody>
            {lines.map((line, i) => {
              let bgClass = 'bg-transparent';
              let textClass = 'text-muted-foreground';
              if (line.startsWith('+')) {
                bgClass = 'bg-green-500/10';
                textClass = 'text-green-400';
              } else if (line.startsWith('-')) {
                bgClass = 'bg-red-500/10';
                textClass = 'text-red-400';
              } else if (line.startsWith('@@')) {
                textClass = 'text-blue-400 font-semibold';
              }
              
              return (
                <tr key={i} className={bgClass}>
                  <td className="pr-3 text-right select-none opacity-30 w-8">{i + 1}</td>
                  <td className={`whitespace-pre ${textClass} break-all`}>{line || ' '}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
