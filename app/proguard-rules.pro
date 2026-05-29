# Keep the JavaScript bridge methods reachable from WebView
-keepclassmembers class com.kids.videoplayer.MainActivity$Bridge {
   public *;
}
