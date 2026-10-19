"""Read public README files for design research; never execute repository code."""
import concurrent.futures
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPOS = [
    'cheeaun/phanpy', 'nolanlawson/pinafore', 'elk-zone/elk',
    'terhechte/Ebou', 'Dimillian/IceCubesApp', 'tunjid/heron',
    'LucasGGamerM/moshidon', 'grycmat/neon', 'Dimillian/IcySky',
    'QuilaguyPrime/the-flock', 'paulio11/P4-Squigl-Twitter-Clone',
    'fatiharapoglu/twitter', 'fidanazhan/django-social-media-clone',
    'noobmaster432/buzznet', 'yossefelnajjar/twitter-clone',
    'dogankaraarslan1/ciaorelated', 'ikhsan3adi/quick_social',
    'zivavu/Clonagram', 'neuralchemist/the-social-network',
    'tkachiko/react-network', 'albeniskerqeli10/react-social-network-v1',
    'misa-j/social-network', 'shahshubh/SocialApp-React-Native',
    'burakorkmez/twitter-clone', 'carlosblinf/socialnetwork-ui',
    'mlatka9/social-network', 'cihandundar/twitter-clone',
    'realanupreet/TwitterClone', 'yousefkhalaf0/frontend-beginner-twitter-clone',
    'shreyadiwakar/Social-media-app', 'Serkanbyx/social-media-platform',
    'yTakkar/React-Instagram-Clone-2.0',
]

def collect(repo):
    result = {'repo': repo, 'url': 'https://github.com/' + repo}
    for branch in ['HEAD', 'main', 'master']:
        url = f'https://raw.githubusercontent.com/{repo}/{branch}/README.md'
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'SoloVerse-Design-Research'})
            with urllib.request.urlopen(request, timeout=20) as response:
                source = response.read(300000).decode('utf-8', errors='replace')
            target = ROOT / 'readmes' / (repo.replace('/', '__') + '.md')
            target.parent.mkdir(exist_ok=True)
            target.write_text(source)
            images = re.findall(r'!\[[^\]]*\]\(([^\s)]+)', source)
            images += re.findall(r'<img[^>]+src=[\"\']([^\"\']+)', source, flags=re.I)
            images = [urllib.parse.urljoin(f'https://raw.githubusercontent.com/{repo}/{branch}/', x) if not x.startswith('http') else x for x in images]
            result.update({'readme': str(target.relative_to(ROOT)), 'readme_url': url,
                           'characters': len(source), 'images': images,
                           'headings': re.findall(r'^#{1,3} .+$', source, re.M)[:18]})
            return result
        except (urllib.error.URLError, TimeoutError):
            continue
    result['error'] = 'README could not be retrieved'
    return result

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(collect, REPOS))
    (ROOT / 'references.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    for result in results:
        print(result['repo'], result.get('characters', result.get('error')), 'images:', len(result.get('images', [])))
    print('README files retrieved:', sum('readme' in r for r in results), '/', len(results))
