import { useState } from 'react';

const useBookmarks = () => {
  const [bookmarks, setBookmarks] = useState([]);

  const addBookmark = (sessionId) => {
    setBookmarks([...bookmarks, sessionId]);
  };

  const removeBookmark = (sessionId) => {
    setBookmarks(bookmarks.filter((id) => id !== sessionId));
  };

  return { bookmarks, addBookmark, removeBookmark };
};

export default useBookmarks;
