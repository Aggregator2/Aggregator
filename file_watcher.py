import time
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from datetime import datetime

# Optional: Path to agent lock/marker files or logs
AGENT_LOG_DIR = './agent_logs'  # Change if you have agent logs/markers

class ChangeHandler(FileSystemEventHandler):
    def on_any_event(self, event):
        if event.is_directory:
            return
        event_type = event.event_type.upper()
        file_path = os.path.relpath(event.src_path)
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        agent = self.get_agent_for_file(file_path)
        agent_str = f" by {agent}" if agent else ""
        print(f"[{timestamp}] {event_type}: {file_path}{agent_str}")

    def get_agent_for_file(self, file_path):
        # Optional: Implement logic to infer agent from logs/markers
        # For now, returns None. You can extend this to check AGENT_LOG_DIR or lock files.
        return None

def main():
    path = '.'  # Monitor current directory (change as needed)
    event_handler = ChangeHandler()
    observer = Observer()
    observer.schedule(event_handler, path, recursive=True)
    print(f"Watching for file changes in: {os.path.abspath(path)}")
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()

if __name__ == "__main__":
    main() 