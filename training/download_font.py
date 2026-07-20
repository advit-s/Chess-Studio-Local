import urllib.request
import os

def main():
    url = "https://github.com/prawnpdf/prawn/raw/master/data/fonts/DejaVuSans.ttf"
    dest = "training/DejaVuSans.ttf"
    print(f"Downloading DejaVuSans.ttf from {url} to {dest}...")
    try:
        urllib.request.urlretrieve(url, dest)
        if os.path.exists(dest) and os.path.getsize(dest) > 100000:
            print("Successfully downloaded DejaVuSans.ttf!")
        else:
            print("Download completed but file is empty or too small.")
    except Exception as e:
        print(f"Error downloading: {e}")

if __name__ == '__main__':
    main()
